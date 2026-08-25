import type { z } from "zod";
import { rethrowIfExhausted } from "../ai/budget";
import type { ModelClient } from "../ai/model-client";
import { sampleUntilValid } from "../ai/sample";
import type { PlanningRepositoryContext } from "../planning/pipeline";
import type { ImplementationPlan } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import { validateTaskPolicy } from "../policy/validate";
import type { RepositoryDiscovery } from "../repository/schemas";
import { specificationLanguage } from "../spec/language";
import type { Spec } from "../spec/schemas";
import { taskPrompts } from "./prompts";
import {
  type TaskList,
  type TaskListReview,
  taskAuditSchema,
  taskListDraftSchema,
  taskListReviewSchema,
  taskQuestionReviewSchema,
} from "./schemas";
import { normalizeTaskList, validateTaskList, validateTaskListReview } from "./validate";

type ObjectGenerator = Pick<ModelClient, "generateObject">;

export async function buildTaskList(
  client: ObjectGenerator,
  spec: Spec,
  plan: ImplementationPlan,
  discovery: RepositoryDiscovery,
  userInput = "",
  repository: PlanningRepositoryContext = { paths: discovery.context.files, snapshots: [] },
  policy: Policy = defaultPolicy,
  constitution = "",
): Promise<TaskList> {
  // Context is declared per stage rather than shared as one blob. Auditing checks IDs, coverage and
  // cycles, so file contents buy it nothing — and shipping the largest payload in the pipeline to
  // the stage that cannot use it is what kept exhausting its output budget.
  const shared = {
    outputLanguage: specificationLanguage(spec),
    specification: spec,
    constitution: constitution || undefined,
    plan,
    policy,
    // One name for one thing across every stage of the phase. The stages used to disagree: the
    // authoring stages were given `discovery` and the checking ones `approvedPaths`, while the
    // prompts for both spoke of `discovery.context.files` — so half of them were enforcing a rule
    // against a field they had not been given.
    approvedPaths: discovery.context.files,
    repositoryIndex: repository.paths,
    userInput: userInput || undefined,
  };
  const authoring = {
    ...shared,
    discovery,
    approvedSnapshots: repository.snapshots,
  };
  const checking = shared;
  const context = authoring;
  // The first draw runs the full draft/audit/review chain; a rejection is repaired instead, which is
  // both cheaper and better informed than starting over.
  let previous: TaskList | undefined;
  return sampleUntilValid(
    policy.sampling.max_attempts,
    async (rejection) => {
      let list: TaskList;
      let review: TaskListReview | undefined;
      if (rejection === undefined || !previous) {
        const draft = await stage("tasks-draft", () =>
          client.generateObject(taskPrompts.draft, pretty(context), taskListDraftSchema),
        );
        const audit = await advisoryStage(() =>
          client.generateObject(taskPrompts.audit, pretty({ ...checking, draft }), taskAuditSchema),
        );
        review = await stage("tasks-review", () =>
          client.generateObject(
            taskPrompts.review,
            // Omitted rather than nulled when the audit did not come back, so the shared prefix the
            // provider caches is unaffected by whether it did.
            pretty(audit === undefined ? { ...checking, draft } : { ...checking, draft, audit }),
            taskListReviewSchema,
          ),
        );
        list = normalizeTaskList(review.tasks, spec.feature);
      } else {
        list = normalizeTaskList(
          await stage("tasks-repair", () =>
            client.generateObject(
              taskPrompts.repair,
              pretty({ ...context, rejectedTasks: previous, validationError: rejection }),
              taskListDraftSchema,
            ),
          ),
          spec.feature,
        );
      }
      if (list.status === "needs_clarification") {
        list = await filterTaskQuestions(client, list, context, spec, discovery, repository.paths);
      }
      previous = list;
      return { list, review };
    },
    ({ list, review }) => {
      // A graph still asking questions is not a rejected draw: the user has to answer first.
      if (list.status !== "ready") return;
      if (review) validateTaskListReview(review);
      validateTaskList(list, spec, discovery, repository.paths);
      validateTaskPolicy(list.tasks, policy, spec);
    },
  ).then(({ list }) => list);
}

export async function runTaskStage(
  client: ObjectGenerator,
  stageName: string,
  input: string,
): Promise<unknown> {
  const definitions = {
    "tasks-draft": [taskPrompts.draft, taskListDraftSchema],
    "tasks-audit": [taskPrompts.audit, taskAuditSchema],
    "tasks-review": [taskPrompts.review, taskListReviewSchema],
    "tasks-questions": [taskPrompts.questions, taskQuestionReviewSchema],
    "tasks-repair": [taskPrompts.repair, taskListDraftSchema],
  } as const;
  const definition = definitions[stageName as keyof typeof definitions];
  if (!definition) return undefined;
  return client.generateObject(definition[0], input, definition[1] as z.ZodType<unknown>);
}

async function filterTaskQuestions(
  client: ObjectGenerator,
  list: TaskList,
  context: Record<string, unknown>,
  spec: Spec,
  discovery: RepositoryDiscovery,
  repositoryPaths: string[],
): Promise<TaskList> {
  const review = await stage("tasks-questions", () =>
    client.generateObject(
      taskPrompts.questions,
      pretty({ ...context, candidate: list }),
      taskQuestionReviewSchema,
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
    return normalizeTaskList({ ...list, status: "needs_clarification", questions }, spec.feature);
  }
  const ready = normalizeTaskList({ ...list, status: "ready", questions: [] }, spec.feature);
  try {
    validateTaskList(ready, spec, discovery, repositoryPaths);
    return ready;
  } catch {
    // Every question was implementation-owned, yet the graph is not executable without an answer.
    // Asking the user beats claiming a ready list that carries no work.
    return list;
  }
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Runs a stage whose output only advises the next one.
 *
 * The audit reports coverage and smells, and every hard thing it reports — coverage, cycles, write
 * ordering, unapproved paths — is recomputed for free and exactly by the validators that actually
 * gate the graph. It is also, measurably, the stage most likely to exhaust its output budget and
 * return nothing: letting that end a run means the phase is only as reliable as its least reliable
 * advisory step, which is the wrong thing to be true.
 */
async function advisoryStage<T>(operation: () => Promise<T>): Promise<T | undefined> {
  return operation().catch((error) => {
    rethrowIfExhausted(error);
    return undefined;
  });
}

async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`Failed ${name}`, { cause: error });
  }
}
