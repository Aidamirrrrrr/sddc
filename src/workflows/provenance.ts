import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../execution/context";
import { featureSlug } from "../spec/storage";

/**
 * Records which upstream artifact each downstream artifact was derived from.
 *
 * Stored artifacts are inputs, not history: a user may edit `spec.yaml` and rerun. Without this
 * record nothing notices that `plan.yaml` still answers the previous specification, and the drift
 * stays invisible until the implementation contradicts the requirements.
 */
export const provenanceSchema = z.object({
  version: z.literal(1),
  plan: z.object({ spec_sha256: z.string() }).optional(),
  tasks: z.object({ spec_sha256: z.string(), plan_sha256: z.string() }).optional(),
});

export type Provenance = z.infer<typeof provenanceSchema>;

function provenancePath(root: string, feature: string): string {
  return join(root, ".specs", featureSlug(feature), "provenance.yaml");
}

export async function artifactDigest(
  root: string,
  feature: string,
  name: string,
): Promise<string | undefined> {
  const file = Bun.file(join(root, ".specs", featureSlug(feature), name));
  return (await file.exists()) ? sha256(await file.text()) : undefined;
}

export async function readProvenance(root: string, feature: string): Promise<Provenance> {
  const file = Bun.file(provenancePath(root, feature));
  if (!(await file.exists())) return { version: 1 };
  try {
    return provenanceSchema.parse(Bun.YAML.parse(await file.text()));
  } catch {
    return { version: 1 };
  }
}

async function write(root: string, feature: string, provenance: Provenance): Promise<void> {
  await mkdir(join(root, ".specs", featureSlug(feature)), { recursive: true });
  await Bun.write(provenancePath(root, feature), Bun.YAML.stringify(provenance, null, 2));
}

export async function recordPlanProvenance(root: string, feature: string): Promise<void> {
  const spec = await artifactDigest(root, feature, "spec.yaml");
  if (!spec) return;
  await write(root, feature, {
    ...(await readProvenance(root, feature)),
    plan: { spec_sha256: spec },
  });
}

export async function recordTaskProvenance(root: string, feature: string): Promise<void> {
  const spec = await artifactDigest(root, feature, "spec.yaml");
  const plan = await artifactDigest(root, feature, "plan.yaml");
  if (!spec || !plan) return;
  await write(root, feature, {
    ...(await readProvenance(root, feature)),
    tasks: { spec_sha256: spec, plan_sha256: plan },
  });
}
