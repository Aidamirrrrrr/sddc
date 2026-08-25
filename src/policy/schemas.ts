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
    /** How many times a draw may be redrawn because its *shape* was rejected: schema, scope, review. */
    max_proposal_revisions: z.number().int().nonnegative(),
    /**
     * How many times a task may look at what its own code actually did and correct it.
     *
     * A different loop from the one above, and the one that makes this phase an agent rather than a
     * single shot: the proposal is applied, the verification commands really run, and their output
     * goes back to the model. Bounded because it is the only loop that costs a model call *and* a
     * command run per turn.
     */
    max_task_iterations: z.number().int().positive(),
    /**
     * How many times one task may be attempted before the run gives up on it.
     *
     * Every other loop in the pipeline is bounded by policy; this one was not, so a task whose
     * verification kept failing could be retried forever as long as something kept saying yes.
     */
    max_task_attempts: z.number().int().positive(),
    command_timeout_seconds: z.number().int().positive(),
    allow_git_checkpoints: z.boolean(),
  }),
});

export type Policy = z.infer<typeof policySchema>;
