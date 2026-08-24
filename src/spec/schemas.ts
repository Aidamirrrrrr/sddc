import { z } from "zod";

export const issueKindSchema = z.enum([
  "missing",
  "ambiguous",
  "contradiction",
  "untestable",
  "scope",
]);

export const extractionSchema = z.object({
  language: z.string(),
  feature: z.string(),
  goal: z.string(),
  facts: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      source_excerpt: z.string(),
    }),
  ),
});

const analysisIssueSchema = z.object({
  id: z.string(),
  kind: issueKindSchema,
  statement: z.string(),
  affects: z.array(z.string()),
});

const analysisQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  reason: z.string(),
  affects: z.array(z.string()),
});

export const ambiguitySchema = z.object({
  issues: z.array(analysisIssueSchema),
  questions: z.array(analysisQuestionSchema).max(3),
});

export const ambiguityFilterSchema = z.object({
  kept_issue_ids: z.array(z.string()),
  kept_question_ids: z.array(z.string()).max(3),
});

export const clarificationSchema = z.object({
  decision: z.enum(["complete", "needs_clarification"]),
  rationale: z.string(),
  questions: z
    .array(
      z.object({
        question: z.string(),
        reason: z.string(),
      }),
    )
    .max(3),
});

export const subfeatureSchema = z.object({
  id: z.string(),
  feature: z.string(),
  goal: z.string(),
  depends_on: z.array(z.string()),
});

export const scopeSchema = z.object({
  decision: z.enum(["focused", "decompose"]),
  rationale: z.string(),
  subfeatures: z.array(subfeatureSchema),
});

export const specSchema = z.object({
  status: z.enum(["ready", "needs_clarification", "needs_decomposition"]),
  feature: z.string(),
  goal: z.string(),
  requirements: z.array(z.object({ id: z.string(), statement: z.string() })),
  acceptance: z.array(
    z.object({
      id: z.string(),
      verifies: z.array(z.string()),
      statement: z.string(),
    }),
  ),
  issues: z.array(
    z.object({
      id: z.string(),
      kind: issueKindSchema,
      statement: z.string(),
      affects: z.array(z.string()),
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
  subfeatures: z.array(subfeatureSchema),
});

export const reviewSchema = z.object({
  spec: specSchema,
  checks: z.array(z.object({ id: z.string(), passed: z.boolean(), finding: z.string() })),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type Ambiguity = z.infer<typeof ambiguitySchema>;
export type AmbiguityFilter = z.infer<typeof ambiguityFilterSchema>;
export type ReviewCheck = z.infer<typeof reviewSchema>["checks"][number];
export type Spec = z.infer<typeof specSchema>;
