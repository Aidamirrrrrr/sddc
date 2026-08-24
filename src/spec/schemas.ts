import { z } from "zod";

const featureIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const issueKindSchema = z.enum([
  "missing",
  "ambiguous",
  "contradiction",
  "untestable",
  "scope",
]);

export const subfeatureSchema = z.object({
  id: z.string(),
  feature: featureIdSchema,
  goal: z.string(),
  fact_ids: z.array(z.string()).min(1),
  depends_on: z.array(z.string()),
});

export const scopeSchema = z.object({
  decision: z.enum(["focused", "decompose"]),
  rationale: z.string(),
  subfeatures: z.array(subfeatureSchema),
});

export const extractionSchema = z.object({
  language: z.string(),
  feature: featureIdSchema,
  goal: z.string(),
  facts: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      source_excerpt: z.string(),
    }),
  ),
});

export const analysisSchema = z.object({
  decision: z.enum(["ready", "needs_clarification", "needs_decomposition"]),
  rationale: z.string(),
  questions: z.array(z.object({ question: z.string(), reason: z.string() })).max(3),
  subfeatures: z.array(subfeatureSchema),
});

export const specSchema = z.object({
  status: z.enum(["ready", "needs_clarification", "needs_decomposition"]),
  feature: featureIdSchema,
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
export type Scope = z.infer<typeof scopeSchema>;
export type ReviewCheck = z.infer<typeof reviewSchema>["checks"][number];
export type Spec = z.infer<typeof specSchema>;
