import type { ModelClient } from "../ai/model-client";
import { finish, success } from "../cli/ui";
import { loadMaxOutputTokens } from "../config/env";
import { executePlan } from "../execution/runner";
import { configureExecution, unattendedExecution } from "../execution/ui";
import { assertTasksFitOutputBudget } from "../execution/validate";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import { validateTaskPolicy } from "../policy/validate";
import type { Spec } from "../spec/schemas";
import type { TaskList } from "../tasks/schemas";
import { recordExecutionProvenance } from "./provenance";

export async function runApprovedExecution(
  client: ModelClient,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  tasks: TaskList,
  policy: Policy,
  upstream: { constitution?: string; clarifications?: string } = {},
  unattended = false,
): Promise<void> {
  const configuration = unattended
    ? unattendedExecution(policy)
    : await configureExecution(root, tasks.feature, tasks.tasks, policy);
  if (!configuration) {
    finish({ en: "Implementation was not started", ru: "Реализация не запущена" });
    return;
  }
  validateTaskPolicy(tasks.tasks, policy, spec);
  await assertTasksFitOutputBudget(root, tasks.tasks, loadMaxOutputTokens());
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
  // Recorded only on a completed run: a failed or blocked one left the workspace part-way, and
  // claiming that code was built from this graph would be the opposite of the truth.
  if (journal.status === "completed") await recordExecutionProvenance(root, plan.feature);
  const path = `.specs/${plan.feature}/execution.yaml`;
  success({
    en: `Execution ${journal.status}; journal saved to ${path}`,
    ru: `Статус выполнения: ${journal.status}; журнал сохранён: ${path}`,
  });
  finish({ en: "sddc finished", ru: "sddc завершил работу" });
}
