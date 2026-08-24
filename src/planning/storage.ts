import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readArtifact } from "../spec/storage";
import { type ImplementationPlan, implementationPlanSchema } from "./schemas";

export async function writeImplementationPlan(plan: ImplementationPlan): Promise<string> {
  const directory = join(process.cwd(), ".specs", plan.feature);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "plan.yaml");
  await Bun.write(path, Bun.YAML.stringify(plan, null, 2));
  return path;
}

export async function readImplementationPlan(
  root: string,
  feature: string,
): Promise<ImplementationPlan> {
  return implementationPlanSchema.parse(await readArtifact(root, feature, "plan.yaml"));
}
