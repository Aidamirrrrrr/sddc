import { z } from "zod";

export const inquiryAnswerSchema = z.object({
  answer: z.string(),
  evidence: z
    .array(
      z.object({
        path: z.string(),
        finding: z.string(),
      }),
    )
    .min(1),
  unknowns: z.array(z.string()),
});

export type InquiryAnswer = z.infer<typeof inquiryAnswerSchema>;
