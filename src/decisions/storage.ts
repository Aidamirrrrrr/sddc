import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Policy } from "../policy/schemas";
import type { DecisionRegistry } from "./schemas";

export async function writeGovernanceArtifacts(
  root: string,
  feature: string,
  registry: DecisionRegistry,
  policy: Policy,
): Promise<{ decisions: string; policy: string }> {
  const directory = join(root, ".specs", feature);
  await mkdir(directory, { recursive: true });
  const decisions = join(directory, "decisions.yaml");
  const policyPath = join(directory, "policy.yaml");
  await Promise.all([
    Bun.write(decisions, Bun.YAML.stringify(registry, null, 2)),
    Bun.write(policyPath, Bun.YAML.stringify(policy, null, 2)),
  ]);
  return { decisions, policy: policyPath };
}
