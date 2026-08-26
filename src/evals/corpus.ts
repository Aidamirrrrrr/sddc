import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type ImplementationPlan, implementationPlanSchema } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import { type Policy, policySchema } from "../policy/schemas";
import { type RepositoryDiscovery, repositoryDiscoverySchema } from "../repository/schemas";
import { type Spec, specSchema } from "../spec/schemas";
import { featureSlug } from "../spec/storage";
import type { TaskList } from "../tasks/schemas";
import { parseStoredTaskList } from "../tasks/storage";

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
    policy: await readPolicy(directory),
    plan: await read(directory, "plan.yaml", implementationPlanSchema),
    tasks: await read(directory, "tasks.yaml", { parse: parseStoredTaskList }),
  };
}

/**
 * Copies a stored feature into the corpus. The artifacts are the case; nothing is transformed.
 *
 * They are checked against each other first. A feature directory is written phase by phase, so a run
 * stopped in the middle of one — or a second run over the top of the first — leaves a `spec.yaml`
 * from one attempt beside a `tasks.yaml` from another. Recorded, that pair becomes a permanent
 * failing case that looks like a validator bug and is really a torn snapshot; this happened on the
 * first three cases ever recorded.
 */
export async function recordCase(root: string, feature: string, name = feature): Promise<string> {
  const source = join(root, ".specs", featureSlug(feature));
  const target = join(corpusPath(root), name);
  const artifacts = ["spec.yaml", "discovery.yaml", "plan.yaml", "tasks.yaml", "policy.yaml"];
  const contents = new Map<string, string>();
  for (const artifact of artifacts) {
    const file = Bun.file(join(source, artifact));
    if (await file.exists()) contents.set(artifact, await file.text());
  }
  if (contents.size === 0) throw new Error(`No artifacts to record for feature "${feature}"`);
  assertAgree(feature, contents);

  await mkdir(target, { recursive: true });
  for (const [artifact, text] of contents) await Bun.write(join(target, artifact), text);
  return target;
}

/** The one thing a torn snapshot always shows: a downstream artifact citing an ID nothing defines. */
function assertAgree(feature: string, contents: Map<string, string>): void {
  const spec = contents.get("spec.yaml");
  const tasks = contents.get("tasks.yaml");
  if (!spec || !tasks) return;
  const parsedSpec = specSchema.parse(Bun.YAML.parse(spec));
  const parsedTasks = parseStoredTaskList(Bun.YAML.parse(tasks));
  const known = new Set([
    ...parsedSpec.requirements.map((item) => item.id),
    ...parsedSpec.acceptance.map((item) => item.id),
  ]);
  const dangling = parsedTasks.tasks
    .flatMap((task) => [...task.requirements, ...task.acceptance])
    .filter((id) => !known.has(id));
  if (dangling.length > 0) {
    throw new Error(
      `Refusing to record "${feature}": tasks.yaml cites ${[...new Set(dangling)].join(", ")}, ` +
        "which spec.yaml does not define. The artifacts come from different attempts — rerun the " +
        "feature and record it once it has finished.",
    );
  }
}

/**
 * A recorded policy, read the way a project's own is.
 *
 * A corpus is historical: cases are recorded once and then outlive several versions of the schema.
 * Demanding today's complete shape from a file written months ago makes every schema addition
 * invalidate the whole corpus at once — which is exactly what happened the first time one grew a
 * field. Merging over the defaults is what `loadPolicy` already does for a partial project policy,
 * and it means a case keeps testing what it was recorded to test.
 */
async function readPolicy(directory: string): Promise<Policy> {
  const file = Bun.file(join(directory, "policy.yaml"));
  if (!(await file.exists())) return defaultPolicy;
  try {
    const stored = Bun.YAML.parse(await file.text()) as Partial<Policy>;
    return policySchema.parse({
      ...defaultPolicy,
      ...stored,
      changes: { ...defaultPolicy.changes, ...stored.changes },
      commands: { ...defaultPolicy.commands, ...stored.commands },
      budget: { ...defaultPolicy.budget, ...stored.budget },
      sampling: { ...defaultPolicy.sampling, ...stored.sampling },
      dialogue: { ...defaultPolicy.dialogue, ...stored.dialogue },
      execution: { ...defaultPolicy.execution, ...stored.execution },
    });
  } catch (error) {
    throw new Error(`Corpus artifact is invalid: ${join(directory, "policy.yaml")}`, {
      cause: error,
    });
  }
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
