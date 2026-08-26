import { join } from "node:path";
import { type Policy, policySchema } from "./schemas";

export const defaultPolicy: Policy = {
  version: 1,
  changes: {
    max_files_per_task: 6,
    max_created_files_per_task: 3,
    max_generated_file_bytes: 128 * 1024,
    forbid_paths: [".git", ".specs", ".env", "credentials"],
    // Off by default until the eval corpus shows models produce conforming graphs reliably;
    // a rule that fails every run would only teach users to switch it off.
    require_test_before_implementation: false,
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
  budget: { max_model_calls: 400 },
  sampling: { max_attempts: 3 },
  dialogue: {
    max_clarification_rounds: 3,
    max_revision_rounds: 5,
  },
  execution: {
    default_approval_mode: "normal",
    max_changed_lines_per_task: 400,
    // Two redraws, not one. The reasoning next to sampling.max_attempts applies here as well: the
    // verifier is free and deterministic, so a further draw costs one model call and buys a real
    // chance of a usable proposal — cheaper than sending the user back to replanning. A single
    // redraw was measured to be spent before the model had corrected anything.
    max_proposal_revisions: 2,
    max_task_iterations: 3,
    max_task_attempts: 3,
    // Two is what a task needs to follow one import it could not see and then one it found behind
    // it. A third has not been observed to answer anything the first two did not.
    max_context_expansions: 2,
    command_timeout_seconds: 120,
    allow_git_checkpoints: false,
  },
};

export async function loadPolicy(root: string): Promise<Policy> {
  const path = join(root, ".sddc", "policy.yaml");
  const file = Bun.file(path);
  if (!(await file.exists())) return defaultPolicy;
  try {
    const override = Bun.YAML.parse(await file.text()) as Partial<Policy>;
    return policySchema.parse({
      ...defaultPolicy,
      ...override,
      changes: { ...defaultPolicy.changes, ...override.changes },
      commands: { ...defaultPolicy.commands, ...override.commands },
      budget: { ...defaultPolicy.budget, ...override.budget },
      sampling: { ...defaultPolicy.sampling, ...override.sampling },
      dialogue: { ...defaultPolicy.dialogue, ...override.dialogue },
      execution: { ...defaultPolicy.execution, ...override.execution },
    });
  } catch (error) {
    throw new Error(`Failed to load policy "${path}"`, { cause: error });
  }
}
