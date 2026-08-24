import type { ModelClient } from "../ai/model-client";
import { finish, success } from "../cli/ui";
import { executePlan } from "../execution/runner";
import { configureExecution } from "../execution/ui";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import { validatePlanPolicy } from "../policy/validate";
import type { Spec } from "../spec/schemas";

export async function runApprovedExecution(
  client: ModelClient,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  policy: Policy,
): Promise<void> {
  const configuration = await configureExecution(root, plan, policy);
  if (!configuration) {
    finish({ en: "Implementation was not started", ru: "Реализация не запущена" });
    return;
  }
  validatePlanPolicy(plan, policy);
  const journal = await executePlan(
    client,
    root,
    spec,
    plan,
    configuration.hooks,
    policy,
    configuration.mode,
  );
  const path = `.specs/${plan.feature}/execution.yaml`;
  success({
    en: `Execution ${journal.status}; journal saved to ${path}`,
    ru: `Статус выполнения: ${journal.status}; журнал сохранён: ${path}`,
  });
  finish({ en: "Codekeeper finished", ru: "Codekeeper завершил работу" });
}
