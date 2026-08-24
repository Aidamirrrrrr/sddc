import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "./schemas";

export async function writeSpec(spec: Spec, approved = true): Promise<string> {
  const directory = specDirectory(spec.feature);
  await mkdir(directory, { recursive: true });
  const path = join(directory, approved ? "spec.yaml" : "spec.draft.yaml");
  await Bun.write(path, Bun.YAML.stringify(spec, null, 2));
  return path;
}

export async function writeRepositoryDiscovery(
  feature: string,
  discovery: RepositoryDiscovery,
): Promise<string> {
  const directory = specDirectory(feature);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "discovery.yaml");
  await Bun.write(path, Bun.YAML.stringify(discovery, null, 2));
  return path;
}

function specDirectory(feature: string): string {
  return join(process.cwd(), ".specs", featureSlug(feature));
}

function featureSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "feature";
}
