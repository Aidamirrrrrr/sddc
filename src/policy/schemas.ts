import { z } from "zod";

export const policySchema = z.object({
  version: z.literal(1),
  changes: z.object({
    max_files_per_task: z.number().int().positive(),
    max_created_files_per_task: z.number().int().nonnegative(),
    max_generated_file_bytes: z.number().int().positive(),
    forbid_paths: z.array(z.string()),
    /**
     * SDD Article III: no implementation before its test. When on, a task that changes behavioural
     * source must depend on a task that writes a test — the same task is not enough, or "first"
     * would mean nothing.
     */
    require_test_before_implementation: z.boolean(),
    require_dependency_permission: z.boolean(),
    require_configuration_permission: z.boolean(),
    require_migration_permission: z.boolean(),
  }),
  commands: z.object({
    allowed_programs: z.array(z.string()).min(1),
    allow_external_network: z.boolean(),
  }),
  sampling: z.object({
    /**
     * How many candidates a phase may draw before giving up.
     *
     * The verifier is free and deterministic, so an extra draw costs one model call and buys a real
     * chance of a valid artifact — cheaper than sending the user back to replanning.
     */
    max_attempts: z.number().int().positive(),
  }),
  dialogue: z.object({
    /** Caps how many times one phase may come back asking the user for a decision. */
    max_clarification_rounds: z.number().int().positive(),
    /** Caps how many times the user may reject an artifact and ask for another version. */
    max_revision_rounds: z.number().int().positive(),
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
