import { z } from "zod";

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  /** Every task must serve something; requirements may be served by several tasks. */
  requirements: z.array(z.string()).min(1),
  /**
   * The acceptance criteria this task owns — and owns exclusively.
   *
   * May be empty: a task that serves a requirement without completing a criterion of its own is
   * legitimate, and under test-first the criterion belongs to the task that writes its test.
   */
  acceptance: z.array(z.string()),
  depends_on: z.array(z.string()),
  permissions: z.array(z.enum(["dependencies", "configuration", "migration", "external_network"])),
  files: z.object({
    read: z.array(z.string()),
    modify: z.array(z.string()),
    create: z.array(z.string()),
  }),
  verification: z
    .array(
      z.object({
        command: z.object({ program: z.string(), args: z.array(z.string()) }),
        purpose: z.string(),
      }),
    )
    .min(1),
  done_when: z.array(z.string()).min(1),
  risks: z.array(z.string()),
});

/** A task after normalization: `wave` and `parallel` are derived from the dependency graph. */
export const executableTaskSchema = taskSchema.extend({
  wave: z.number().int().positive(),
  parallel: z.boolean(),
});

export const taskListDraftSchema = z.object({
  status: z.enum(["ready", "needs_clarification"]),
  feature: z.string(),
  summary: z.string(),
  tasks: z.array(taskSchema),
  questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        reason: z.string(),
        blocking: z.boolean(),
      }),
    )
    .max(3),
});

export const taskListSchema = taskListDraftSchema.extend({
  tasks: z.array(executableTaskSchema),
});

export const taskAuditSchema = z.object({
  decision: z.enum(["ready", "needs_clarification"]),
  requirement_coverage: z.array(
    z.object({ requirement: z.string(), task_ids: z.array(z.string()) }),
  ),
  acceptance_coverage: z.array(z.object({ acceptance: z.string(), task_ids: z.array(z.string()) })),
  findings: z.array(z.object({ severity: z.enum(["blocking", "warning"]), statement: z.string() })),
  questions: z.array(z.object({ question: z.string(), reason: z.string() })).max(3),
});

export const taskListReviewSchema = z.object({
  tasks: taskListDraftSchema,
  checks: z.array(z.object({ id: z.string(), passed: z.boolean(), finding: z.string() })),
});

export const taskQuestionReviewSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        reason: z.string(),
        owner: z.enum(["user", "implementation"]),
        answerable_from_context: z.boolean(),
        affects: z.array(z.string()),
        user_visible_impact: z.boolean(),
      }),
    )
    .max(3),
});

export type Task = z.infer<typeof executableTaskSchema>;
export type TaskListDraft = z.infer<typeof taskListDraftSchema>;
export type TaskList = z.infer<typeof taskListSchema>;
export type TaskListReview = z.infer<typeof taskListReviewSchema>;
