import { success } from "../cli/ui";
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
  success({
    en: `Decision registry saved to ${governance.decisions}`,
    ru: `Реестр решений сохранён: ${governance.decisions}`,
  });
  success({
    en: `Effective policy saved to ${governance.policy}`,
    ru: `Политика сохранена: ${governance.policy}`,
  });
}
