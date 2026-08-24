import { z } from "zod";

export const decisionRegistrySchema = z.object({
  feature: z.string(),
  decisions: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["product", "context", "implementation", "permission"]),
      owner: z.enum(["user", "repository", "agent", "policy"]),
      statement: z.string(),
      source: z.string(),
      evidence: z.array(z.string()),
      status: z.enum(["accepted", "inferred"]),
    }),
  ),
});

export type DecisionRegistry = z.infer<typeof decisionRegistrySchema>;
