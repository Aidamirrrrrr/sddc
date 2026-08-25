import type { ReviewCheck, Spec } from "./schemas";

export function normalizeClarificationQuestions(
  questions: Array<{ question: string; reason: string }>,
): Array<{ question: string; reason: string }> {
  return questions.map((item) => ({
    ...item,
    question: stripSuggestedExamples(item.question),
    reason: stripSuggestedExamples(item.reason),
  }));
}

/**
 * Removes a suggested answer from a question, and nothing else.
 *
 * A question that carries its own example answers it for the user, which is what the prompts already
 * forbid; this is the deterministic backstop. It stops at the end of the sentence the example is in:
 * cutting to the end of the string also deleted every question that followed, turning one
 * over-helpful clause into lost questions.
 *
 * The word boundary is spelled out rather than written `\b`, which is defined over ASCII word
 * characters and therefore never matches after a Cyrillic word — so on Russian questions, the very
 * language this runs on most, the rule silently did nothing at all.
 */
function stripSuggestedExamples(question: string): string {
  return question
    .replace(/\s*\((?:например|for example|e\.g\.)[^)]*\)/giu, "")
    .replace(/[,;]\s*(?:например|for example|e\.g\.)(?!\p{L})[^.?!]*/giu, "")
    .replace(/\s+(?:например|for example|e\.g\.)(?!\p{L})[^.?!]*/giu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function validateReview(checks: ReviewCheck[]): void {
  const passed = new Set(checks.filter((item) => item.passed).map((item) => item.id));
  const missing = Array.from({ length: 15 }, (_, index) => `C${index + 1}`).filter(
    (id) => !passed.has(id),
  );
  if (missing.length > 0) {
    throw new Error(`Spec review failed checks: ${missing.join(", ")}`);
  }
}

export function validateSpec(spec: Spec): void {
  if (spec.status === "ready" && spec.requirements.length === 0) {
    throw new Error("Ready specification has no requirements");
  }
  if (spec.status === "needs_clarification" && spec.questions.length === 0) {
    throw new Error("Clarification status has no questions");
  }
  if (spec.status === "needs_decomposition" && spec.subfeatures.length < 2) {
    throw new Error("Decomposition status has fewer than two subfeatures");
  }
  const covered = new Set(spec.acceptance.flatMap((item) => item.verifies));
  const uncovered = spec.requirements.filter((item) => !covered.has(item.id));
  if (spec.status === "ready" && uncovered.length > 0) {
    throw new Error(
      `Requirements without acceptance coverage: ${uncovered.map((item) => item.id).join(", ")}`,
    );
  }
}
