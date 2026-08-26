import { z } from "zod";

export const changeProposalSchema = z.object({
  task_id: z.string(),
  status: z.enum(["ready", "blocked"]),
  summary: z.string(),
  blocker: z
    .object({
      reason: z.string(),
      required_files: z.array(z.string()),
      required_decision: z.string().nullable(),
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
      operation: z.enum(["modify", "create", "delete"]),
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
