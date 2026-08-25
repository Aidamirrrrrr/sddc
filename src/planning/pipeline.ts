import type { z } from "zod";
import { rethrowIfExhausted } from "../ai/budget";
import type { ModelClient } from "../ai/model-client";
import { sampleUntilValid } from "../ai/sample";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import { type FileSnapshot, indexRepository, readSnapshots } from "../repository/scan";
import type { RepositoryDiscovery } from "../repository/schemas";
import { specificationLanguage } from "../spec/language";
import type { Spec } from "../spec/schemas";
import { planningPrompts } from "./prompts";
import {
  type ImplementationPlan,
  implementationPlanSchema,
  planAuditSchema,
  planQuestionReviewSchema,
  planReviewSchema,
} from "./schemas";
import { normalizePlan, validatePlan, validatePlanReview } from "./validate";

type ObjectGenerator = Pick<ModelClient, "generateObject">;
export type PlanningRepositoryContext = { paths: string[]; snapshots: FileSnapshot[] };

export async function preparePlanningContext(
  root: string,
  discovery: RepositoryDiscovery,
): Promise<PlanningRepositoryContext> {
  const index = await indexRepository(root);
  return {
    paths: index.map((file) => file.path),
    snapshots: await readSnapshots(root, index, discovery.context.files),
  };
}

export async function buildImplementationPlan(
  client: ObjectGenerator,
  spec: Spec,
  discovery: RepositoryDiscovery,
  userInput = "",
  repository: PlanningRepositoryContext = {
    paths: discovery.context.files,
    snapshots: [],
  },
  policy: Policy = defaultPolicy,
  constitution = "",
): Promise<ImplementationPlan> {
  const context = {
    outputLanguage: specificationLanguage(spec),
    specification: spec,
    constitution: constitution || undefined,
    discovery,
    repositoryIndex: repository.paths,
    approvedSnapshots: repository.snapshots,
    policy,
    userInput: userInput || undefined,
  };
  // One draw is a full draft/audit/review chain; a rejected one is repaired rather than restarted,
  // which is both cheaper and better informed. The plan phase used to get exactly one repair and
  // then fail the run, while tasks and execution already sampled — the verifier is the same price
  // here, so there was no reason for this phase to be the brittle one.
  let previous: ImplementationPlan | undefined;
  return sampleUntilValid(
    policy.sampling.max_attempts,
    async (rejection) => {
      if (rejection === undefined || !previous) {
        const draft = await stage("planning-draft", () =>
          client.generateObject(planningPrompts.draft, pretty(context), implementationPlanSchema),
        );
        // Advisory, like the task audit: nothing it reports gates the plan, and letting it end the
        // run made the phase only as reliable as a step whose output is a hint.
        const audit = await client
          .generateObject(planningPrompts.audit, pretty({ ...context, draft }), planAuditSchema)
          .catch((error) => {
            rethrowIfExhausted(error);
            return undefined;
          });
        const review = await stage("planning-review", () =>
          client.generateObject(
            planningPrompts.review,
            pretty(audit === undefined ? { ...context, draft } : { ...context, draft, audit }),
            planReviewSchema,
          ),
        );
        let plan = normalizePlan(review.plan, spec.feature);
        if (plan.status === "needs_clarification") {
          plan = await filterPlanQuestions(client, plan, context, spec, discovery);
        }
        previous = plan;
        return { plan, review };
      }
      let plan = normalizePlan(
        await stage("planning-repair", () =>
          client.generateObject(
            planningPrompts.repair,
            pretty({ ...context, rejectedPlan: previous, validationError: rejection }),
            implementationPlanSchema,
          ),
        ),
        spec.feature,
      );
      if (plan.status === "needs_clarification") {
        plan = await filterPlanQuestions(client, plan, context, spec, discovery);
      }
      previous = plan;
      return { plan, review: undefined };
    },
    ({ plan, review }) => {
      // A plan still asking questions is not a rejected draw: the user has to answer first.
      if (plan.status !== "ready") return;
      if (review) validatePlanReview(review);
      validatePlan(plan, spec, discovery);
    },
  ).then(({ plan }) => plan);
}

export async function runPlanningStage(
  client: ObjectGenerator,
  stageName: string,
  input: string,
): Promise<unknown> {
  const definitions = {
    "planning-draft": [planningPrompts.draft, implementationPlanSchema],
    "planning-audit": [planningPrompts.audit, planAuditSchema],
    "planning-review": [planningPrompts.review, planReviewSchema],
    "planning-questions": [planningPrompts.questions, planQuestionReviewSchema],
    "planning-repair": [planningPrompts.repair, implementationPlanSchema],
  } as const;
  const definition = definitions[stageName as keyof typeof definitions];
  if (!definition) return undefined;
  return client.generateObject(definition[0], input, definition[1] as z.ZodType<unknown>);
}

async function filterPlanQuestions(
  client: ObjectGenerator,
  plan: ImplementationPlan,
  context: Record<string, unknown>,
  spec: Spec,
  discovery: RepositoryDiscovery,
): Promise<ImplementationPlan> {
  const review = await stage("planning-questions", () =>
    client.generateObject(
      planningPrompts.questions,
      pretty({ ...context, candidate: plan }),
      planQuestionReviewSchema,
    ),
  );
  const traceableIds = new Set([
    ...spec.requirements.map((item) => item.id),
    ...spec.acceptance.map((item) => item.id),
  ]);
  const questions = review.questions
    .filter(
      (question) =>
        question.owner === "user" &&
        !question.answerable_from_context &&
        question.user_visible_impact &&
        question.affects.length > 0 &&
        question.affects.every((id) => traceableIds.has(id)),
    )
    .map((question, index) => ({
      id: `Q${index + 1}`,
      question: question.question,
      reason: question.reason,
      blocking: true,
    }));
  if (questions.length > 0) {
    return normalizePlan({ ...plan, status: "needs_clarification", questions }, spec.feature);
  }
  const ready = normalizePlan({ ...plan, status: "ready", questions: [] }, spec.feature);
  try {
    validatePlan(ready, spec, discovery);
    return ready;
  } catch {
    // The filtered questions were implementation-owned, but the plan still does not stand on its
    // own. Return the original questions so the user is asked instead of failing the run.
    return plan;
  }
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`Failed ${name}`, { cause: error });
  }
}
