import { z } from "zod";

export const fileSelectionSchema = z.object({
  files: z.array(z.object({ path: z.string(), reason: z.string() })).max(24),
  rationale: z.string(),
});

export type FileSelection = z.infer<typeof fileSelectionSchema>;

const evidencedFindingSchema = z.object({
  statement: z.string(),
  evidence: z.array(z.string()).min(1),
});

export const repositoryDiscoverySchema = z.object({
  context: z.object({
    files: z.array(z.string()),
    user_context: z.string(),
  }),
  summary: z.string(),
  technologies: z.array(
    z.object({ name: z.string(), purpose: z.string(), evidence: z.array(z.string()).min(1) }),
  ),
  structure: z.array(
    z.object({ area: z.string(), purpose: z.string(), evidence: z.array(z.string()).min(1) }),
  ),
  relevant_files: z.array(
    z.object({ path: z.string(), purpose: z.string(), symbols: z.array(z.string()) }),
  ),
  conventions: z.array(evidencedFindingSchema),
  testing: z.array(evidencedFindingSchema),
  constraints: z.array(evidencedFindingSchema),
  unknowns: z.array(z.string()),
});

export type RepositoryDiscovery = z.infer<typeof repositoryDiscoverySchema>;
