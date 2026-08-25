import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { readTaskFiles, sha256 } from "./context";
import { applyProposal, type FileBackup, restoreFiles } from "./files";
import { buildTaskProposal } from "./pipeline";
import { renderProposal } from "./render";
import type { ExecutionHooks } from "./runner";
import type { ChangeProposal, ExecutionJournal, ExecutionTaskResult } from "./schemas";
import { runVerification } from "./verify";

export type TaskOutcome =
  | { kind: "completed"; result: ExecutionTaskResult; backup: FileBackup }
  | { kind: "retry"; feedback: string }
  | { kind: "failed"; result: ExecutionTaskResult }
  | { kind: "blocked"; proposal: ChangeProposal };

/** Everything a task needs before anything is written: the current files and the model's proposal. */
export type TaskPreparation = {
  files: Awaited<ReturnType<typeof readTaskFiles>>;
  proposal: ChangeProposal;
};

/**
 * The read-only half of executing a task. Split out so independent tasks in one wave can have their
 * proposals generated concurrently while the writes that follow stay strictly ordered.
 */
export async function prepareTask(
  client: Pick<ModelClient, "generateObject">,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  task: Task,
  feedback: string,
  policy: Policy,
): Promise<TaskPreparation> {
  const files = await readTaskFiles(root, task);
  const proposal = await buildTaskProposal(client, root, spec, plan, task, feedback, policy);
  return { files, proposal };
}

export async function executeTask(
  client: Pick<ModelClient, "generateObject">,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  task: Task,
  hooks: ExecutionHooks,
  policy: Policy,
  mode: ExecutionJournal["mode"],
  feedback: string,
  prepared?: TaskPreparation,
): Promise<TaskOutcome> {
  const { files, proposal } =
    prepared ?? (await prepareTask(client, root, spec, plan, task, feedback, policy));
  if (proposal.status === "blocked") return { kind: "blocked", proposal };
  if (
    task.permissions.length > 0 &&
    hooks.approveSensitive &&
    !(await hooks.approveSensitive(task))
  ) {
    return { kind: "blocked", proposal: blockedByUser(task, proposal) };
  }
  if (mode !== "trusted") {
    const review = await hooks.review(task, proposal, renderProposal(proposal, files));
    if (!review.accepted)
      return { kind: "retry", feedback: `User rejected proposal: ${review.feedback}` };
  }

  const backup = await applyProposal(root, proposal);
  let verification: ExecutionTaskResult["verification"];
  try {
    verification = await runVerification(root, task, {
      policy,
      approve:
        (mode === "strict" || task.permissions.includes("external_network")) && hooks.approveCommand
          ? (item) => hooks.approveCommand?.(task, item) ?? Promise.resolve(false)
          : undefined,
    });
  } catch (error) {
    await restoreFiles(root, backup);
    throw new Error(`Failed to run verification for ${task.id}`, { cause: error });
  }
  const result: ExecutionTaskResult = {
    task_id: task.id,
    status: verification.every((item) => item.exit_code === 0) ? "completed" : "failed",
    changed_files: proposal.changes.map((change) => change.path),
    verification,
    output_hashes: proposal.changes.map((change) => ({
      path: change.path,
      sha256: sha256(change.content),
    })),
    checkpoint: null,
  };
  if (result.status === "failed") {
    await restoreFiles(root, backup);
    if (await hooks.retryAfterFailure(task, result)) {
      return {
        kind: "retry",
        feedback: `Verification failed and all changes were rolled back:\n${formatFailure(result)}`,
      };
    }
    return { kind: "failed", result };
  }
  return { kind: "completed", result, backup };
}

function blockedByUser(task: Task, proposal: ChangeProposal): ChangeProposal {
  return {
    ...proposal,
    status: "blocked",
    summary: "Sensitive permission was not confirmed",
    blocker: {
      reason: `User did not confirm: ${task.permissions.join(", ")}`,
      required_files: [...task.files.modify, ...task.files.create],
      required_decision: "Revise the plan or explicitly approve the sensitive operation",
    },
    changes: [],
  };
}

function formatFailure(result: ExecutionTaskResult): string {
  return result.verification
    .filter((item) => item.exit_code !== 0)
    .map((item) => `$ ${item.program} ${item.args.join(" ")}\n${item.output}`)
    .join("\n");
}
