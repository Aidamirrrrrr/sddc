import type { ModelClient } from "../ai/model-client";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import type { ExecutionFile } from "./context";
import { executionPrompts } from "./prompts";
import { type ChangeProposal, type ExecutionReview, executionReviewSchema } from "./schemas";

export async function reviewProposal(
  client: Pick<ModelClient, "generateObject">,
  spec: Spec,
  task: Task,
  files: ExecutionFile[],
  proposal: ChangeProposal,
): Promise<ExecutionReview> {
  const review = await client.generateObject(
    executionPrompts.review,
    JSON.stringify({ specification: spec, task, original_files: files, proposal }, null, 2),
    executionReviewSchema,
  );
  validateExecutionReview(review);
  return review;
}

export function validateExecutionReview(review: ExecutionReview): void {
  const passed = new Set(review.checks.filter((check) => check.passed).map((check) => check.id));
  const missing = Array.from({ length: 7 }, (_, index) => `E${index + 1}`).filter(
    (id) => !passed.has(id as ExecutionReview["checks"][number]["id"]),
  );
  if (review.decision !== "pass" || missing.length > 0) {
    const findings = review.findings.length > 0 ? review.findings.join("; ") : missing.join(", ");
    throw new Error(`Execution review rejected proposal: ${findings}`);
  }
}
