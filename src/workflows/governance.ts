import { buildDecisionRegistry } from "../decisions/build";
import { writeGovernanceArtifacts } from "../decisions/storage";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";

export async function persistGovernance(
  root: string,
  spec: Spec,
  discovery: RepositoryDiscovery,
  plan: ImplementationPlan,
  policy: Policy,
): Promise<void> {
  const governance = await writeGovernanceArtifacts(
    root,
    spec.feature,
    buildDecisionRegistry(spec, discovery, plan),
    policy,
  );
  console.log(`Decision registry written to ${governance.decisions}`);
  console.log(`Effective policy written to ${governance.policy}`);
}
