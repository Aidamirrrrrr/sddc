import type { ModelClient } from "../ai/model-client";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import type { ExecutionFile } from "./context";
import { executionPrompts } from "./prompts";
import { type ChangeProposal, type ExecutionReview, executionReviewSchema } from "./schemas";

/**
 * Everything the reviewer needs to answer its own checks.
 *
 * E7 asks whether the proposal introduces an undeclared decision, and E1 whether the task's
 * criteria are met. Neither is answerable from the specification alone: what counts as *declared*
 * lives in the accepted plan and the constitution, and whether verification should come out red or
 * green is the host's call. Handing the reviewer less than the implementer had made it reject
 * correct work for being unexplained.
 */
export type ReviewContext = {
  spec: Spec;
  task: Task;
  files: ExecutionFile[];
  plan: unknown;
  constitution: string | undefined;
  outputLanguage: string;
  expectation: string;
  otherTasks: unknown;
};

export async function reviewProposal(
  client: Pick<ModelClient, "generateObject">,
  proposal: ChangeProposal,
  context: ReviewContext,
): Promise<ExecutionReview> {
  const review = await client.generateObject(
    executionPrompts.review,
    JSON.stringify(
      {
        outputLanguage: context.outputLanguage,
        specification: context.spec,
        constitution: context.constitution,
        plan: context.plan,
        task: context.task,
        expectation: context.expectation,
        otherTasks: context.otherTasks,
        original_files: context.files,
        proposal,
      },
      null,
      2,
    ),
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
