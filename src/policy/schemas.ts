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
  budget: z.object({
    /**
     * The whole run's ceiling on model calls.
     *
     * Sized to bound a runaway rather than to shape a normal run: a small feature measures at
     * roughly thirty calls end to end, while the nested per-task budgets can multiply into the
     * hundreds on a graph that keeps refusing itself. It should never fire on work that is going
     * well, and always fire before an invoice does.
     */
    max_model_calls: z.number().int().positive(),
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
    /**
     * How many times one task may ask to read a file it was not granted.
     *
     * Its own budget rather than a share of the turns, because answering a read request is not an
     * attempt at the work: nothing has been written and nothing has been verified. Bounded all the
     * same — an unbounded appetite for context is how a task talks its way to the whole repository.
     */
    max_context_expansions: z.number().int().nonnegative(),
    command_timeout_seconds: z.number().int().positive(),
    allow_git_checkpoints: z.boolean(),
  }),
});

export type Policy = z.infer<typeof policySchema>;
