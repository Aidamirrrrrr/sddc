import type { ModelClient } from "../ai/model-client";
import { finish, success } from "../cli/ui";
import { executePlan } from "../execution/runner";
import { configureExecution } from "../execution/ui";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import { validateTaskPolicy } from "../policy/validate";
import type { Spec } from "../spec/schemas";
import type { TaskList } from "../tasks/schemas";

export async function runApprovedExecution(
  client: ModelClient,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  tasks: TaskList,
  policy: Policy,
  upstream: { constitution?: string; clarifications?: string } = {},
): Promise<void> {
  const configuration = await configureExecution(root, tasks.feature, tasks.tasks, policy);
  if (!configuration) {
    finish({ en: "Implementation was not started", ru: "Реализация не запущена" });
    return;
  }
  validateTaskPolicy(tasks.tasks, policy, spec);
  const journal = await executePlan(
    client,
    root,
    spec,
    plan,
    tasks.tasks,
    configuration.hooks,
    policy,
    configuration.mode,
    undefined,
    upstream,
  );
  const path = `.specs/${plan.feature}/execution.yaml`;
  success({
    en: `Execution ${journal.status}; journal saved to ${path}`,
    ru: `Статус выполнения: ${journal.status}; журнал сохранён: ${path}`,
  });
  finish({ en: "sddc finished", ru: "sddc завершил работу" });
}
