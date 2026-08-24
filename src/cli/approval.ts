import type { Spec } from "../spec/schemas";

export type ReviewDecision = "accept" | "revise";

export function formatSpec(spec: Spec): string {
  return Bun.YAML.stringify(spec, null, 2).trimEnd();
}

export function parseReviewDecision(input: string): ReviewDecision | null {
  const value = input.trim().toLocaleLowerCase();
  if (["a", "accept", "approve", "y", "yes"].includes(value)) return "accept";
  if (["r", "revise", "reject", "n", "no"].includes(value)) return "revise";
  return null;
}
