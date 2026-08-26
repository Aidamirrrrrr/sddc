import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import { writesOnlyTests } from "../policy/paths";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { runTaskAgent, WorkspaceMovedError } from "./agent";
import { readTaskFiles, sha256 } from "./context";
import { type FileBackup, restoreFiles } from "./files";
import { buildTaskProposal, type ProposalContext } from "./pipeline";
import { renderProposal } from "./render";
import type { ExecutionHooks } from "./runner";
import type { ChangeProposal, ExecutionJournal, ExecutionTaskResult } from "./schemas";
import { ranToCompletion } from "./verify";

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
  graph: Task[] = [task],
  stage: ProposalContext = {},
): Promise<TaskPreparation> {
  // Read once and hand the same snapshot to the proposal. Reading twice meant the diff shown to the
  // user and the content the proposal was validated against could come from two different moments.
  const files = await readTaskFiles(root, task);
  const proposal = await buildTaskProposal(
    client,
    root,
    spec,
    plan,
    task,
    feedback,
    policy,
    graph,
    {
      ...stage,
      files,
    },
  );
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
  graph: Task[] = [task],
  stage: ProposalContext = {},
): Promise<TaskOutcome> {
  if (
    task.permissions.length > 0 &&
    hooks.approveSensitive &&
    !(await hooks.approveSensitive(task))
  ) {
    return { kind: "blocked", proposal: blockedByUser(task) };
  }

  // The task now runs as a loop that writes, verifies and corrects itself inside its own approved
  // scope, so the workspace is touched before the user has approved anything. That is the price of
  // letting the model see what its code actually does — and it is fully refundable: every turn folds
  // into one backup, and every path out of here either keeps the result or restores it exactly.
  let outcome: Awaited<ReturnType<typeof runTaskAgent>>;
  try {
    outcome = await runTaskAgent({
      client,
      root,
      spec,
      plan,
      task,
      policy,
      graph,
      stage,
      feedback,
      ...(prepared && !feedback ? { prepared } : {}),
      ...(shouldApproveCommands(task, mode) && hooks.approveCommand
        ? { approveCommand: (item) => hooks.approveCommand?.(task, item) ?? Promise.resolve(false) }
        : {}),
      ...(hooks.taskProgress
        ? { onTurn: (turn, checks) => hooks.taskProgress?.(task, turn, checks) }
        : {}),
      // Reading is not writing, so only strict mode stops to ask. The host checks every requested
      // path against the same rules in every mode either way.
      ...(mode === "strict" && hooks.approveFiles
        ? {
            approveFiles: (request) =>
              hooks.approveFiles?.(task, request) ?? Promise.resolve(false),
          }
        : {}),
      ...(hooks.filesRequested
        ? {
            onFilesRequested: (granted, refusals) =>
              hooks.filesRequested?.(task, granted, refusals),
          }
        : {}),
    });
  } catch (error) {
    // A workspace that moved under a proposal is a stale draw and another one fixes it. Anything
    // else — a provider that is down, a budget spent on refusals — is not improved by asking again,
    // so it travels on and the run names the task it could not produce.
    if (!(error instanceof WorkspaceMovedError)) throw error;
    return {
      kind: "retry",
      feedback: `The change could not be applied: ${errorMessage(error)}. Rebuild it from the supplied file contents.`,
    };
  }

  if (outcome.kind === "blocked") return { kind: "blocked", proposal: outcome.proposal };

  const { proposal, files, verification } = outcome.turn;
  const result: ExecutionTaskResult = {
    task_id: task.id,
    status: outcome.kind === "settled" ? "completed" : "failed",
    changed_files: proposal.changes.map((change) => change.path),
    verification,
    output_hashes: proposal.changes.map((change) => ({
      path: change.path,
      sha256: sha256(change.content),
    })),
    checkpoint: null,
  };

  if (result.status === "failed") {
    // Whether the failure predates the task is settled inside the loop now, against a baseline taken
    // before anything was written; by the time we are here the task really is answerable for it.
    await restoreFiles(root, outcome.backup);
    if (await hooks.retryAfterFailure(task, result)) {
      return { kind: "retry", feedback: failureFeedback(task, policy, result) };
    }
    return { kind: "failed", result };
  }

  // The user now approves a change that has already passed its verification, rather than approving
  // a guess and finding out afterwards.
  if (mode !== "trusted") {
    const review = await hooks.review(task, proposal, renderProposal(proposal, files));
    if (!review.accepted) {
      await restoreFiles(root, outcome.backup);
      return { kind: "retry", feedback: `User rejected proposal: ${review.feedback}` };
    }
  }
  return { kind: "completed", result, backup: outcome.backup };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Strict mode confirms every command; anything touching the network is confirmed in every mode. */
function shouldApproveCommands(task: Task, mode: ExecutionJournal["mode"]): boolean {
  return mode === "strict" || task.permissions.includes("external_network");
}

/**
 * Whether verification came out the way this task's verification is supposed to come out.
 *
 * Under test-first a task that writes only tests runs before its implementation exists, so a green
 * suite is the failure: a test that passes without the code it covers asserts nothing. Rather than
 * exempting such a task from verification — an exemption is a hole — the expectation is inverted,
 * which makes red-green discipline something the host enforces instead of something it tolerates.
 */
export function verificationSatisfied(
  task: Task,
  policy: Policy,
  verification: ExecutionTaskResult["verification"],
): boolean {
  const green = verification.length > 0 && verification.every((item) => item.exit_code === 0);
  const expectsRed =
    policy.changes.require_test_before_implementation && writesOnlyTests(task.files);
  return expectsRed ? failedAsATest(verification) : green;
}

/**
 * A red that is actually a failing test, rather than anything at all going wrong.
 *
 * Accepting any non-zero exit made the inverted expectation trivially satisfiable: a syntax error,
 * a missing binary or a timeout all counted as "the test correctly fails". Those say the suite never
 * got to run an assertion, which is the opposite of what test-first is asking for. `ranToCompletion`
 * draws that line, and draws it in one place so this rule and the inherited-failure rule cannot end
 * up disagreeing about what a command's exit code meant.
 */
function failedAsATest(verification: ExecutionTaskResult["verification"]): boolean {
  const last = verification.at(-1);
  if (!last || !ranToCompletion(last)) return false;
  return last.exit_code > 0;
}

function blockedByUser(task: Task): ChangeProposal {
  return {
    task_id: task.id,
    status: "blocked",
    summary: "Sensitive permission was not confirmed",
    blocker: {
      reason: `User did not confirm: ${task.permissions.join(", ")}`,
      required_files: [...task.files.modify, ...task.files.create],
      required_decision: "Revise the plan or explicitly approve the sensitive operation",
    },
    needs_files: null,
    traceability: [],
    changes: [],
  };
}

/** An inverted expectation fails with every command green, so it needs its own explanation. */
export function failureFeedback(task: Task, policy: Policy, result: ExecutionTaskResult): string {
  if (policy.changes.require_test_before_implementation && writesOnlyTests(task.files)) {
    const last = result.verification.at(-1);
    // Two different failures wear the same status here, and the feedback has to tell them apart or
    // the next draw corrects the wrong thing.
    if (last && (last.timed_out || last.exit_code >= 126)) {
      return (
        `The test suite could not be run, so nothing was asserted either way:\n` +
        `${formatFailure(result)}\nWrite a test the existing suite can execute.`
      );
    }
    return (
      `The new test passed before its implementation exists, so it asserts nothing. ` +
      `Write a test that fails until ${task.requirements.join(", ")} is implemented.`
    );
  }
  return `Verification failed and all changes were rolled back:\n${formatFailure(result)}`;
}

function formatFailure(result: ExecutionTaskResult): string {
  return result.verification
    .filter((item) => item.exit_code !== 0)
    .map((item) => `$ ${item.program} ${item.args.join(" ")}\n${item.output}`)
    .join("\n");
}
