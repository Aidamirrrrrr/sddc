import { z } from "zod";

export const requestIntentSchema = z.object({
  intent: z.enum(["change", "inquiry", "unclear"]),
  language: z.string(),
  rationale: z.string(),
  question: z.string(),
});

export type RequestIntent = z.infer<typeof requestIntentSchema>;
