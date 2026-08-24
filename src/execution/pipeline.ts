import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import { readTaskFiles } from "./context";
import { executionPrompts } from "./prompts";
import { reviewProposal } from "./review";
import { type ChangeProposal, changeProposalSchema, executionReviewSchema } from "./schemas";
import { validateProposal } from "./validate";

type ObjectGenerator = Pick<ModelClient, "generateObject">;

export async function buildTaskProposal(
  client: ObjectGenerator,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  task: ImplementationPlan["tasks"][number],
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
      rejected_proposal: proposal,
      validation_error: error instanceof Error ? error.message : String(error),
      instruction: "Correct the proposal once without expanding the approved scope.",
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
      review_error: error instanceof Error ? error.message : String(error),
      instruction: "Correct the reviewed proposal once without expanding the approved scope.",
    });
    validateProposal(proposal, task, files, policy);
    if (proposal.status === "blocked") return proposal;
    await reviewProposal(client, spec, task, files, proposal);
  }
  return proposal;
}

export function orderTasks(plan: ImplementationPlan): ImplementationPlan["tasks"] {
  const remaining = new Map(plan.tasks.map((task) => [task.id, task]));
  const completed = new Set<string>();
  const ordered: ImplementationPlan["tasks"] = [];
  while (remaining.size > 0) {
    const next = plan.tasks.find(
      (task) => remaining.has(task.id) && task.depends_on.every((id) => completed.has(id)),
    );
    if (!next) throw new Error("Implementation plan has no executable task order");
    ordered.push(next);
    remaining.delete(next.id);
    completed.add(next.id);
  }
  return ordered;
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
