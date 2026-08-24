import type { ModelClient } from "../ai/model-client";
import { taskDocument, taskSummary } from "../cli/presentation";
import { document, required, reviewDocument, withSpinner } from "../cli/ui";
import type { PlanningRepositoryContext } from "../planning/pipeline";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import { buildTaskList } from "../tasks/pipeline";
import type { TaskList } from "../tasks/schemas";

export async function createApprovedTaskList(
  client: ModelClient,
  spec: Spec,
  plan: ImplementationPlan,
  discovery: RepositoryDiscovery,
  policy: Policy,
  repository: PlanningRepositoryContext,
  constitution = "",
): Promise<TaskList> {
  let userInput = "";
  while (true) {
    const list = await withSpinner(
      { en: "Deriving the task graph", ru: "Собираю граф задач" },
      { en: "Task graph is ready for review", ru: "Граф задач готов к проверке" },
      () =>
        buildTaskList(client, spec, plan, discovery, userInput, repository, policy, constitution),
    );
    if (list.status === "needs_clarification") {
      userInput += "\n\nUser task clarifications:\n";
      for (const question of list.questions) {
        document(
          { en: `Decision needed · ${question.id}`, ru: `Нужно решение · ${question.id}` },
          `${question.question}\n\n${question.reason}`,
        );
        userInput += `${question.id}: ${await required({ en: "Your answer", ru: "Ваш ответ" })}\n`;
      }
      continue;
    }

    const rendered = Bun.YAML.stringify(list, null, 2).trimEnd();
    if (
      (await reviewDocument(
        { en: "Accept this task graph?", ru: "Принять этот граф задач?" },
        { en: "Tasks", ru: "Задачи" },
        taskSummary(list),
        taskDocument(list),
      )) === "accept"
    ) {
      return list;
    }
    const feedback = await required({
      en: "What should be changed in the tasks?",
      ru: "Что нужно изменить в задачах?",
    });
    userInput += `\n\nRejected task graph:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}
