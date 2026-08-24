import type { z } from "zod";
import type { ModelClient } from "../ai/model-client";
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
  const context = {
    outputLanguage: specificationLanguage(spec),
    specification: spec,
    constitution: constitution || undefined,
    plan,
    discovery,
    repositoryIndex: repository.paths,
    approvedSnapshots: repository.snapshots,
    policy,
    userInput: userInput || undefined,
  };
  const draft = await stage("tasks-draft", () =>
    client.generateObject(taskPrompts.draft, pretty(context), taskListDraftSchema),
  );
  const audit = await stage("tasks-audit", () =>
    client.generateObject(taskPrompts.audit, pretty({ ...context, draft }), taskAuditSchema),
  );
  const review = await stage("tasks-review", () =>
    client.generateObject(
      taskPrompts.review,
      pretty({ ...context, draft, audit }),
      taskListReviewSchema,
    ),
  );
  let list = normalizeTaskList(review.tasks, spec.feature);
  if (list.status === "needs_clarification") {
    list = await filterTaskQuestions(client, list, context, spec);
  }
  try {
    if (list.status === "ready") validateTaskListReview(review);
    validateTaskList(list, spec, discovery, repository.paths);
    validateTaskPolicy(list.tasks, policy);
    return list;
  } catch (error) {
    list = normalizeTaskList(
      await stage("tasks-repair", () =>
        client.generateObject(
          taskPrompts.repair,
          pretty({ ...context, rejectedTasks: list, validationError: errorMessage(error) }),
          taskListDraftSchema,
        ),
      ),
      spec.feature,
    );
    if (list.status === "needs_clarification") {
      list = await filterTaskQuestions(client, list, context, spec);
    }
    validateTaskList(list, spec, discovery, repository.paths);
    validateTaskPolicy(list.tasks, policy);
    return list;
  }
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
  return normalizeTaskList(
    { ...list, status: questions.length > 0 ? "needs_clarification" : "ready", questions },
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
