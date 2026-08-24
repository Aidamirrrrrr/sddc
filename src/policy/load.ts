import { join } from "node:path";
import { type Policy, policySchema } from "./schemas";

export const defaultPolicy: Policy = {
  version: 1,
  changes: {
    max_files_per_task: 6,
    max_created_files_per_task: 3,
    forbid_paths: [".git", ".specs", ".env", "credentials"],
    require_dependency_permission: true,
    require_configuration_permission: true,
    require_migration_permission: true,
  },
  commands: {
    allowed_programs: [
      "bun",
      "cargo",
      "deno",
      "go",
      "make",
      "node",
      "npm",
      "npx",
      "pnpm",
      "pytest",
      "python",
      "python3",
      "yarn",
    ],
    allow_external_network: false,
  },
};

export async function loadPolicy(root: string): Promise<Policy> {
  const path = join(root, ".spec-agent", "policy.yaml");
  const file = Bun.file(path);
  if (!(await file.exists())) return defaultPolicy;
  try {
    const override = Bun.YAML.parse(await file.text()) as Partial<Policy>;
    return policySchema.parse({
      ...defaultPolicy,
      ...override,
      changes: { ...defaultPolicy.changes, ...override.changes },
      commands: { ...defaultPolicy.commands, ...override.commands },
    });
  } catch (error) {
    throw new Error(`Failed to load policy "${path}"`, { cause: error });
  }
}
