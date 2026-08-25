import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type ImplementationPlan, implementationPlanSchema } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import { type Policy, policySchema } from "../policy/schemas";
import { type RepositoryDiscovery, repositoryDiscoverySchema } from "../repository/schemas";
import { type Spec, specSchema } from "../spec/schemas";
import { featureSlug } from "../spec/storage";
import { type TaskList, taskListSchema } from "../tasks/schemas";

/**
 * A case is an accepted run, frozen.
 *
 * Nothing has to be hand-labelled: a stored feature already holds artifacts a user reviewed and
 * approved, which is exactly the ground truth an eval needs. Recording one is a copy.
 */
export type EvalCase = {
  name: string;
  spec: Spec;
  discovery: RepositoryDiscovery;
  policy: Policy;
  plan?: ImplementationPlan;
  tasks?: TaskList;
};

export const CORPUS_DIRECTORY = "evals";

export function corpusPath(root: string): string {
  return join(root, CORPUS_DIRECTORY);
}

export async function loadCorpus(root: string): Promise<EvalCase[]> {
  const entries = await readdir(corpusPath(root), { withFileTypes: true }).catch(() => []);
  const cases: EvalCase[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const item = await loadCase(root, entry.name);
    if (item) cases.push(item);
  }
  return cases.sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadCase(root: string, name: string): Promise<EvalCase | undefined> {
  const directory = join(corpusPath(root), name);
  const spec = await read(directory, "spec.yaml", specSchema);
  const discovery = await read(directory, "discovery.yaml", repositoryDiscoverySchema);
  if (!spec || !discovery) return undefined;
  return {
    name,
    spec,
    discovery,
    policy: (await read(directory, "policy.yaml", policySchema)) ?? defaultPolicy,
    plan: await read(directory, "plan.yaml", implementationPlanSchema),
    tasks: await read(directory, "tasks.yaml", taskListSchema),
  };
}

/** Copies a stored feature into the corpus. The artifacts are the case; nothing is transformed. */
export async function recordCase(root: string, feature: string, name = feature): Promise<string> {
  const source = join(root, ".specs", featureSlug(feature));
  const target = join(corpusPath(root), name);
  await mkdir(target, { recursive: true });
  let copied = 0;
  for (const artifact of [
    "spec.yaml",
    "discovery.yaml",
    "plan.yaml",
    "tasks.yaml",
    "policy.yaml",
  ]) {
    const file = Bun.file(join(source, artifact));
    if (!(await file.exists())) continue;
    await Bun.write(join(target, artifact), await file.text());
    copied += 1;
  }
  if (copied === 0) throw new Error(`No artifacts to record for feature "${feature}"`);
  return target;
}

async function read<T>(
  directory: string,
  name: string,
  schema: { parse(value: unknown): T },
): Promise<T | undefined> {
  const file = Bun.file(join(directory, name));
  if (!(await file.exists())) return undefined;
  try {
    return schema.parse(Bun.YAML.parse(await file.text()));
  } catch (error) {
    throw new Error(`Corpus artifact is invalid: ${join(directory, name)}`, { cause: error });
  }
}
