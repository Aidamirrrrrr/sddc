import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { readTaskFiles } from "./context";
import { executionPrompts } from "./prompts";
import { reviewProposal } from "./review";
import { type ChangeProposal, changeProposalSchema, executionReviewSchema } from "./schemas";
import { validateProposal } from "./validate";

type ObjectGenerator = Pick<ModelClient, "generateObject">;

/**
 * The default repair instruction warns against expanding scope, which pushes a model that has just
 * refused a task toward refusing it again. When the refusal itself was what got rejected, the
 * instruction has to say the opposite.
 */
function repairInstruction(rejectedBlocker: boolean): string {
  return rejectedBlocker
    ? "Your previous blocker was rejected as factually wrong: the approved scope already covers " +
        "every file you need. Produce the change instead of a blocker."
    : "Correct the proposal once without expanding the approved scope.";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function buildTaskProposal(
  client: ObjectGenerator,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  task: Task,
  feedback = "",
  policy: Policy = defaultPolicy,
): Promise<ChangeProposal> {
  const files = await readTaskFiles(root, task);
  const context = { specification: spec, plan_summary: plan.summary, task, files, feedback };
  let revisions = 0;
  let proposal = await generate(client, context);
  try {
    validateProposal(proposal, task, files, policy);
  } catch (error) {
    if (revisions >= policy.execution.max_proposal_revisions) throw error;
    revisions += 1;
    proposal = await generate(client, {
      ...context,
      // A rejected blocker's stated reason is wrong by definition, and echoing it back was measured
      // to re-anchor the model on it. Only the fact that it was refused travels forward.
      rejected_proposal: proposal.status === "blocked" ? { status: "blocked" } : proposal,
      validation_error: errorMessage(error),
      instruction: repairInstruction(proposal.status === "blocked"),
    });
    validateProposal(proposal, task, files, policy);
  }
  if (proposal.status === "blocked") return proposal;
  try {
    await reviewProposal(client, spec, task, files, proposal);
  } catch (error) {
    if (revisions >= policy.execution.max_proposal_revisions) throw error;
    revisions += 1;
    proposal = await generate(client, {
      ...context,
      rejected_proposal: proposal,
      review_error: errorMessage(error),
      instruction: "Correct the reviewed proposal once without expanding the approved scope.",
    });
    validateProposal(proposal, task, files, policy);
    if (proposal.status === "blocked") return proposal;
    await reviewProposal(client, spec, task, files, proposal);
  }
  return proposal;
}

export async function runExecutionStage(
  client: ObjectGenerator,
  stageName: string,
  input: string,
): Promise<unknown> {
  if (stageName === "execution-implement") {
    return client.generateObject(executionPrompts.implement, input, changeProposalSchema);
  }
  if (stageName === "execution-review") {
    return client.generateObject(executionPrompts.review, input, executionReviewSchema);
  }
  return undefined;
}

async function generate(
  client: ObjectGenerator,
  context: Record<string, unknown>,
): Promise<ChangeProposal> {
  return client.generateObject(
    executionPrompts.implement,
    JSON.stringify(context, null, 2),
    changeProposalSchema,
  );
}
