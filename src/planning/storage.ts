import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ImplementationPlan } from "./schemas";

export async function writeImplementationPlan(plan: ImplementationPlan): Promise<string> {
  const directory = join(process.cwd(), ".specs", plan.feature);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "plan.yaml");
  await Bun.write(path, Bun.YAML.stringify(plan, null, 2));
  return path;
}
