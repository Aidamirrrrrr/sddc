import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import { writesOnlyTests } from "../policy/paths";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { readTaskFiles, sha256 } from "./context";
import { applyProposal, type FileBackup, restoreFiles } from "./files";
import { buildTaskProposal, type ProposalContext } from "./pipeline";
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
  const { files, proposal } =
    prepared ?? (await prepareTask(client, root, spec, plan, task, feedback, policy, graph, stage));
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

  // The workspace can move under a proposal — a prefetched sibling was built from an older
  // snapshot, an editor saved, a formatter ran. That is a stale draw, not a broken run, so it goes
  // back through the ordinary retry with the reason attached instead of escaping as an exception.
  let backup: FileBackup;
  try {
    backup = await applyProposal(root, proposal);
  } catch (error) {
    return {
      kind: "retry",
      feedback: `The workspace changed after the proposal was built: ${errorMessage(error)}. Rebuild the change from the supplied file contents.`,
    };
  }
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
    status: verificationSatisfied(task, policy, verification) ? "completed" : "failed",
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
    // A task is answerable for what its change broke, not for what was already broken. Under
    // test-first the suite is deliberately red from the moment the test task lands, so every task
    // sharing that wave was being blamed for a failure it did not cause and could not fix.
    const inherited =
      stage.suiteRedByDesign === true && (await inheritedFailure(root, task, policy, verification));
    if (inherited) {
      const restored = await applyProposal(root, proposal);
      return {
        kind: "completed",
        result: { ...result, status: "completed", verification: annotate(verification) },
        backup: restored,
      };
    }
    if (await hooks.retryAfterFailure(task, result)) {
      return { kind: "retry", feedback: failureFeedback(task, policy, result) };
    }
    return { kind: "failed", result };
  }
  return { kind: "completed", result, backup };
}

/**
 * Whether the verification was already failing this way before the task touched anything.
 *
 * Re-runs the same commands against the restored tree, which is why it costs nothing on the happy
 * path: it only ever runs after a failure, when the files have just been rolled back anyway. The
 * same command failing the same way on code the task never wrote is not evidence against the task.
 *
 * Deliberately strict — the command and its exit code must match — so a task that breaks the build
 * in a new way is still caught, and the caller only asks at all once this run has deliberately left
 * the suite red. A verification that fails no matter what is still a failure.
 */
async function inheritedFailure(
  root: string,
  task: Task,
  policy: Policy,
  verification: ExecutionTaskResult["verification"],
): Promise<boolean> {
  const failed = verification.find((item) => item.exit_code !== 0);
  if (!failed || failed.timed_out) return false;
  // No approval hook: these exact commands were approved for this task moments ago.
  const baseline = await runVerification(root, task, { policy }).catch(() => undefined);
  const before = baseline?.find(
    (item) => item.program === failed.program && item.args.join(" ") === failed.args.join(" "),
  );
  return before !== undefined && before.exit_code === failed.exit_code;
}

/** Keeps the journal honest about why a failing command was not held against the task. */
function annotate(
  verification: ExecutionTaskResult["verification"],
): ExecutionTaskResult["verification"] {
  return verification.map((item) =>
    item.exit_code === 0
      ? item
      : {
          ...item,
          output: `${item.output}\n[this command failed the same way before the task ran; not attributed to it]`,
        },
  );
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
 * got to run an assertion, which is the opposite of what test-first is asking for. Exit codes are the
 * only framework-agnostic signal available here — 126/127 mean the command could not be executed and
 * anything above 128 means it was killed by a signal, so only the ordinary failure range counts.
 */
function failedAsATest(verification: ExecutionTaskResult["verification"]): boolean {
  const last = verification.at(-1);
  if (!last || last.timed_out) return false;
  return last.exit_code > 0 && last.exit_code < 126;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** An inverted expectation fails with every command green, so it needs its own explanation. */
function failureFeedback(task: Task, policy: Policy, result: ExecutionTaskResult): string {
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
