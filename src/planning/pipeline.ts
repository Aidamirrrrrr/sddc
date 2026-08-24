import type { z } from "zod";
import type { ModelClient } from "../ai/model-client";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import { validatePlanPolicy } from "../policy/validate";
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
): Promise<ImplementationPlan> {
  const context = {
    outputLanguage: specificationLanguage(spec),
    specification: spec,
    discovery,
    repositoryIndex: repository.paths,
    approvedSnapshots: repository.snapshots,
    policy,
    userInput: userInput || undefined,
  };
  const draft = await stage("planning-draft", () =>
    client.generateObject(planningPrompts.draft, pretty(context), implementationPlanSchema),
  );
  const audit = await stage("planning-audit", () =>
    client.generateObject(planningPrompts.audit, pretty({ ...context, draft }), planAuditSchema),
  );
  const review = await stage("planning-review", () =>
    client.generateObject(
      planningPrompts.review,
      pretty({ ...context, draft, audit }),
      planReviewSchema,
    ),
  );
  let plan = normalizePlan(review.plan, spec.feature);
  if (plan.status === "needs_clarification") {
    plan = await filterPlanQuestions(client, plan, context, spec);
  }
  try {
    if (plan.status === "ready") validatePlanReview(review);
    validatePlan(plan, spec, discovery, repository.paths);
    validatePlanPolicy(plan, policy);
    return plan;
  } catch (error) {
    plan = normalizePlan(
      await stage("planning-repair", () =>
        client.generateObject(
          planningPrompts.repair,
          pretty({ ...context, rejectedPlan: plan, validationError: errorMessage(error) }),
          implementationPlanSchema,
        ),
      ),
      spec.feature,
    );
    if (plan.status === "needs_clarification") {
      plan = await filterPlanQuestions(client, plan, context, spec);
    }
    validatePlan(plan, spec, discovery, repository.paths);
    validatePlanPolicy(plan, policy);
    return plan;
  }
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
  return normalizePlan(
    { ...plan, status: questions.length > 0 ? "needs_clarification" : "ready", questions },
    spec.feature,
  );
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`Failed ${name}`, { cause: error });
  }
}
