import { z } from "zod";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  requirements: z.array(z.string()).min(1),
  acceptance: z.array(z.string()).min(1),
  depends_on: z.array(z.string()),
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

export const implementationPlanSchema = z.object({
  status: z.enum(["ready", "needs_clarification"]),
  feature: z.string(),
  summary: z.string(),
  decisions: z.array(
    z.object({
      statement: z.string(),
      rationale: z.string(),
      evidence: z.array(z.string()).min(1),
    }),
  ),
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

export const planAuditSchema = z.object({
  decision: z.enum(["ready", "needs_clarification"]),
  requirement_coverage: z.array(
    z.object({ requirement: z.string(), task_ids: z.array(z.string()) }),
  ),
  acceptance_coverage: z.array(z.object({ acceptance: z.string(), task_ids: z.array(z.string()) })),
  findings: z.array(z.object({ severity: z.enum(["blocking", "warning"]), statement: z.string() })),
  questions: z.array(z.object({ question: z.string(), reason: z.string() })).max(3),
});

export const planReviewSchema = z.object({
  plan: implementationPlanSchema,
  checks: z.array(z.object({ id: z.string(), passed: z.boolean(), finding: z.string() })),
});

export const planQuestionReviewSchema = z.object({
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

export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;
export type PlanReview = z.infer<typeof planReviewSchema>;
