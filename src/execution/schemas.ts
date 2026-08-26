import { z } from "zod";

export const changeProposalSchema = z.object({
  task_id: z.string(),
  /**
   * `needs_files` sits between the other two on purpose.
   *
   * A task's readable set is fixed while the graph is planned, by a model that has not yet seen the
   * verification fail. When the failure names a file outside that set there used to be two moves:
   * guess, or block — and blocking ends the run and sends the user back to replanning. One of those
   * situations is recoverable and the other is not, and collapsing them into the irrecoverable one
   * threw away runs that had nothing wrong with them.
   *
   * Reading is not writing: nothing lands, nothing needs rolling back, and the host still decides
   * what may be read. So the model asks, and the answer arrives as ordinary context on the next
   * draw.
   */
  status: z.enum(["ready", "blocked", "needs_files"]),
  summary: z.string(),
  blocker: z
    .object({
      reason: z.string(),
      required_files: z.array(z.string()),
      required_decision: z.string().nullable(),
    })
    .nullable(),
  /**
   * Read-only files the task wants before it can produce a change.
   *
   * Never grants write access: whatever arrives here is added to what the task may *see* on the next
   * turn, and `files.modify` is untouched. Nullable rather than optional, matching `blocker`, because
   * every property in these schemas is required — strict structured output wants it that way.
   */
  needs_files: z
    .object({
      reason: z.string(),
      paths: z
        .array(z.object({ path: z.string(), reason: z.string() }))
        .min(1)
        .max(6),
    })
    .nullable(),
  /**
   * What each changed file is for.
   *
   * The field was called `requirement_id`, and models filled it with requirements only — the
   * acceptance criteria a task owns were silently left out, which the validator then rejected on
   * every draw. The name was the whole cause: it said requirement, so it got requirements. It now
   * says what it holds, which is a requirement ID or an acceptance criterion ID.
   */
  traceability: z.array(
    z.object({
      covers: z.string(),
      paths: z.array(z.string()).min(1),
    }),
  ),
  changes: z.array(
    z.object({
      path: z.string(),
      operation: z.enum(["modify", "create"]),
      expected_sha256: z.string().nullable(),
      content: z.string(),
    }),
  ),
});

/**
 * The reviewer's verdict is the checks, and only the checks.
 *
 * There used to be a `decision` field beside them. It was redundant — the verdict is a function of
 * seven booleans — and being redundant it could disagree: a live run was refused by a review that
 * had marked every check passed and written "No issues found" in its own findings. A second source
 * of truth for something already determined is not a safeguard, it is a way to be wrong.
 *
 * A reviewer with a concern now has to name the check it belongs to, which is the actionable form
 * anyway; anything that fails nothing goes in findings as a note.
 */
export const executionReviewSchema = z.object({
  checks: z.array(
    z.object({
      id: z.enum(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]),
      passed: z.boolean(),
      finding: z.string(),
    }),
  ),
  findings: z.array(z.string()),
});

export const executionJournalSchema = z.object({
  feature: z.string(),
  status: z.enum(["in_progress", "awaiting_acceptance", "completed", "failed", "blocked"]),
  mode: z.enum(["strict", "normal", "trusted"]),
  pending_feedback: z.object({ task_id: z.string(), feedback: z.string() }).nullable(),
  tasks: z.array(
    z.object({
      task_id: z.string(),
      status: z.enum(["completed", "failed"]),
      changed_files: z.array(z.string()),
      verification: z.array(
        z.object({
          program: z.string(),
          args: z.array(z.string()),
          exit_code: z.number().int(),
          timed_out: z.boolean(),
          output: z.string(),
        }),
      ),
      output_hashes: z.array(z.object({ path: z.string(), sha256: z.string() })),
      checkpoint: z.string().nullable(),
    }),
  ),
});

export type ChangeProposal = z.infer<typeof changeProposalSchema>;
export type ExecutionReview = z.infer<typeof executionReviewSchema>;
export type ExecutionJournal = z.infer<typeof executionJournalSchema>;
export type ExecutionTaskResult = ExecutionJournal["tasks"][number];
