import type { ModelClient } from "../ai/model-client";
import { sampleUntilValid } from "../ai/sample";
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

/**
 * What the rest of the graph is doing, read-only.
 *
 * Without this a task sees only itself and reasons as though it were the whole change, so it blocks
 * whenever its own slice leaves the code incoherent — refusing to add a type because the function
 * using it does not exist yet, when a sibling task is about to add exactly that. Permissions are
 * unaffected: writing is still governed solely by the task's own files.
 */
function graphOutline(graph: Task[], current: Task) {
  return graph
    .filter((task) => task.id !== current.id)
    .map((task) => ({
      id: task.id,
      title: task.title,
      wave: task.wave,
      depends_on: task.depends_on,
      writes: [...task.files.modify, ...task.files.create],
      covers: [...task.requirements, ...task.acceptance],
    }));
}

export async function buildTaskProposal(
  client: ObjectGenerator,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  task: Task,
  feedback = "",
  policy: Policy = defaultPolicy,
  graph: Task[] = [task],
): Promise<ChangeProposal> {
  const files = await readTaskFiles(root, task);
  const context = {
    specification: spec,
    plan_summary: plan.summary,
    task,
    otherTasks: graphOutline(graph, task),
    files,
    feedback,
  };
  // One loop for both gates: a proposal has to survive deterministic validation and the read-only
  // reviewer, and a rejection from either is what the next draw is told about.
  let previous: ChangeProposal | undefined;
  return sampleUntilValid(
    policy.execution.max_proposal_revisions + 1,
    async (rejection) => {
      const proposal = await generate(
        client,
        rejection === undefined || !previous
          ? context
          : {
              ...context,
              // A rejected blocker's stated reason is wrong by definition, and echoing it back was
              // measured to re-anchor the model on it. Only the refusal itself travels forward.
              rejected_proposal: previous.status === "blocked" ? { status: "blocked" } : previous,
              validation_error: rejection,
              instruction: repairInstruction(previous.status === "blocked"),
            },
      );
      previous = proposal;
      return proposal;
    },
    async (proposal) => {
      validateProposal(proposal, task, files, policy);
      // A blocker that survived validation is a real one: it is an answer, not a bad draw.
      if (proposal.status === "blocked") return;
      await reviewProposal(client, spec, task, files, proposal);
    },
  );
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
