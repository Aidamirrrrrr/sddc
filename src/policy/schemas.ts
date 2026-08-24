import { z } from "zod";

export const policySchema = z.object({
  version: z.literal(1),
  changes: z.object({
    max_files_per_task: z.number().int().positive(),
    max_created_files_per_task: z.number().int().nonnegative(),
    max_generated_file_bytes: z.number().int().positive(),
    forbid_paths: z.array(z.string()),
    require_dependency_permission: z.boolean(),
    require_configuration_permission: z.boolean(),
    require_migration_permission: z.boolean(),
  }),
  commands: z.object({
    allowed_programs: z.array(z.string()).min(1),
    allow_external_network: z.boolean(),
  }),
  execution: z.object({
    default_approval_mode: z.enum(["strict", "normal", "trusted"]),
    max_changed_lines_per_task: z.number().int().positive(),
    max_proposal_revisions: z.number().int().nonnegative(),
    command_timeout_seconds: z.number().int().positive(),
    allow_git_checkpoints: z.boolean(),
  }),
});

export type Policy = z.infer<typeof policySchema>;
