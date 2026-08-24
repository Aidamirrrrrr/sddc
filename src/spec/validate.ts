import type { ReviewCheck, Spec } from "./schemas";

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
