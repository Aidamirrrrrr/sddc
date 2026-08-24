import type { ModelClient } from "../ai/model-client";
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
  if (!configuration) return;
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
  console.log(
    `Execution ${journal.status}. Journal written to .specs/${plan.feature}/execution.yaml`,
  );
}
