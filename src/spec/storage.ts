import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Spec } from "./schemas";

export async function writeSpec(spec: Spec, approved = true): Promise<string> {
  const directory = join(process.cwd(), ".specs", featureSlug(spec.feature));
  await mkdir(directory, { recursive: true });
  const path = join(directory, approved ? "spec.yaml" : "spec.draft.yaml");
  await Bun.write(path, Bun.YAML.stringify(spec, null, 2));
  return path;
}

function featureSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "feature";
}
