import type { ModelClient } from "../ai/model-client";
import { taskDocument, taskSummary } from "../cli/presentation";
import type { PlanningRepositoryContext } from "../planning/pipeline";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import { buildTaskList } from "../tasks/pipeline";
import type { TaskList } from "../tasks/schemas";
import { type DialogueContext, initialState } from "./context";
import { converge } from "./dialogue";

export async function createApprovedTaskList(
  client: ModelClient,
  spec: Spec,
  plan: ImplementationPlan,
  discovery: RepositoryDiscovery,
  policy: Policy,
  repository: PlanningRepositoryContext,
  constitution = "",
  context: DialogueContext,
): Promise<TaskList> {
  return converge({
    phase: "tasks",
    root: context.root,
    request: context.request,
    policy,
    initial: initialState(context, "tasks"),
    build: (input) =>
      buildTaskList(client, spec, plan, discovery, input, repository, policy, constitution),
    progress: { en: "Deriving the task graph", ru: "Собираю граф задач" },
    complete: { en: "Task graph is ready for review", ru: "Граф задач готов к проверке" },
    title: { en: "Tasks", ru: "Задачи" },
    reviewPrompt: { en: "Accept this task graph?", ru: "Принять этот граф задач?" },
    revisePrompt: {
      en: "What should be changed in the tasks?",
      ru: "Что нужно изменить в задачах?",
    },
    summary: taskSummary,
    details: taskDocument,
    render: (list) => Bun.YAML.stringify(list, null, 2).trimEnd(),
    clarificationHeading: "User task clarifications:",
    rejectionHeading: "Rejected task graph:",
  });
}
