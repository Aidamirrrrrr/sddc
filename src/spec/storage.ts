import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type RepositoryDiscovery, repositoryDiscoverySchema } from "../repository/schemas";
import { type Spec, specSchema } from "./schemas";

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

export function featureSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "feature";
}

export async function readSpec(root: string, feature: string): Promise<Spec> {
  return specSchema.parse(await readArtifact(root, feature, "spec.yaml"));
}

export async function readRepositoryDiscovery(
  root: string,
  feature: string,
): Promise<RepositoryDiscovery> {
  return repositoryDiscoverySchema.parse(await readArtifact(root, feature, "discovery.yaml"));
}

export async function readArtifact(root: string, feature: string, name: string): Promise<unknown> {
  const path = join(root, ".specs", featureSlug(feature), name);
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Missing artifact: ${path}`);
  return Bun.YAML.parse(await file.text());
}
