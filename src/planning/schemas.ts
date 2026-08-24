import { z } from "zod";

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
  approach: z
    .array(
      z.object({
        id: z.string(),
        statement: z.string(),
        requirements: z.array(z.string()),
        touches: z.array(z.string()),
      }),
    )
    .min(1),
  contracts: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["http", "cli", "event", "module", "storage"]),
      surface: z.string(),
      change: z.enum(["new", "extended", "unchanged"]),
    }),
  ),
  data_model: z.array(
    z.object({
      entity: z.string(),
      fields: z.array(z.string()),
      change: z.enum(["new", "extended", "unchanged"]),
    }),
  ),
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
    z.object({ requirement: z.string(), approach_ids: z.array(z.string()) }),
  ),
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
