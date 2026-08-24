import { expect, test } from "bun:test";
import { validateExecutionReview } from "./review";
import type { ExecutionReview } from "./schemas";

test("execution review requires every quality check", () => {
  const review: ExecutionReview = {
    decision: "pass",
    checks: Array.from({ length: 7 }, (_, index) => ({
      id: `E${index + 1}` as ExecutionReview["checks"][number]["id"],
      passed: true,
      finding: "Passed",
    })),
    findings: [],
  };
  expect(() => validateExecutionReview(review)).not.toThrow();
  review.checks[4] = { id: "E5", passed: false, finding: "Error is swallowed" };
  expect(() => validateExecutionReview(review)).toThrow("Execution review rejected proposal");
});
