import { rethrowIfFatal } from "../ai/budget";
import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { type ExecutionFile, readTaskFiles } from "./context";
import { applyProposal, emptyBackup, type FileBackup, restoreFiles } from "./files";
import { buildTaskProposal, type ProposalContext, reviewContextFor } from "./pipeline";
import { reviewProposal } from "./review";
import type { ChangeProposal, ExecutionTaskResult } from "./schemas";
import { verificationSatisfied } from "./task-executor";
import { ranToCompletion, runVerification } from "./verify";

type Verification = ExecutionTaskResult["verification"];

/**
 * The workspace moved between reading a file and writing it.
 *
 * Its own type because it is the one failure in here that another draw genuinely fixes: a prefetched
 * proposal built from an older snapshot, an editor saving, a formatter running. Everything else that
 * throws — a provider that is down, a budget spent on refusals — is not improved by asking again, and
 * the caller has to be able to tell them apart.
 */
export class WorkspaceMovedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "WorkspaceMovedError";
    this.cause = cause;
  }
}

export type AgentTurn = {
  proposal: ChangeProposal;
  files: ExecutionFile[];
  verification: Verification;
};

export type AgentOutcome =
  /** Verification came out the way the host requires. The changes are on disk. */
  | { kind: "settled"; turn: AgentTurn; backup: FileBackup; turns: number }
  /** The budget ran out with verification still wrong. The changes are on disk. */
  | { kind: "exhausted"; turn: AgentTurn; backup: FileBackup; turns: number }
  /** The task refused, and the refusal survived the validator. Nothing was written. */
  | { kind: "blocked"; proposal: ChangeProposal };

export type AgentOptions = {
  client: Pick<ModelClient, "generateObject">;
  root: string;
  spec: Spec;
  plan: ImplementationPlan;
  task: Task;
  policy: Policy;
  graph: Task[];
  stage: ProposalContext;
  /** Carried in from a user rejection or an earlier attempt at this task. */
  feedback: string;
  /** Approves a verification command; asked once per task, not once per turn. */
  approveCommand?: (item: Task["verification"][number]) => Promise<boolean>;
  /** Lets the caller show progress; a turn can take a model call plus a test run. */
  onTurn?: (turn: number, verification: Verification) => void;
  /** Supplied by the prefetcher, so a proposal generated ahead of time is not thrown away. */
  prepared?: { files: ExecutionFile[]; proposal: ChangeProposal };
};

/**
 * Runs one task as an agent, inside the scope that task was already granted.
 *
 * The phase used to be a single shot: the model wrote every file blind, the host ran the commands
 * afterwards, and a failure came back as one line of prose asking for the whole thing again. It
 * could not see what its own code did, which is why it argued about whether a test may call a
 * function that does not exist instead of writing one and looking at the result.
 *
 * So the loop closes here: propose, apply, actually run the verification, hand the real output back,
 * and let the next turn correct itself against a workspace it can now observe.
 *
 * Nothing about the contract moves. The writable set is still exactly `files.modify` and
 * `files.create`, enforced per turn by the same validator; the commands are still the task's own,
 * run by the host in a sanitized environment; what counts as success is still
 * `verificationSatisfied`, so Article III's inverted expectation governs the loop rather than being
 * something the loop can talk its way out of. Every turn's pre-state is folded into one backup, so
 * abandoning the task restores the workspace exactly as if it had never started.
 */
export async function runTaskAgent(options: AgentOptions): Promise<AgentOutcome> {
  const { client, root, spec, plan, task, policy, graph, stage } = options;
  const turns = Math.max(1, policy.execution.max_task_iterations);
  let approved: boolean | undefined;
  /**
   * Whether this task's commands may run at all, asked once and reused.
   *
   * Every path that runs a command goes through here. The baseline below used to call the runner
   * directly, so in strict mode — and for a task holding external_network, which is confirmed in
   * every mode — the task's own commands ran once before the user had been asked anything at all.
   * The approval is per task, not per turn: asking again each turn would make strict mode unusable
   * without making it any stricter.
   */
  const commandsApproved = async (): Promise<boolean> => {
    if (!options.approveCommand) return true;
    if (approved === undefined) approved = await confirmAll(task, options.approveCommand);
    return approved;
  };
  // Taken once, before anything is written, and only when this run has already left the suite red on
  // purpose. A task is answerable for what its change broke, not for what was broken when it
  // arrived — and without this the loop asks a task with nothing left to fix to fix something,
  // which it answers by returning the same file and being rejected for not changing it.
  //
  // Skipped outright when the commands were refused: a command that never ran says nothing about the
  // pre-state, and recording the refusal as the baseline would let the loop later match a refusal
  // against a refusal and call the task inherited-green.
  const baseline =
    stage.suiteRedByDesign && (await commandsApproved())
      ? await runVerification(root, task, { policy }).catch(() => undefined)
      : undefined;
  let backup: FileBackup = emptyBackup();
  let feedback = options.feedback;
  let last: AgentTurn | undefined;
  /** The best turn seen: one whose commands came out the way the host requires. */
  let satisfied: AgentTurn | undefined;
  /** Why the reviewer refused that turn, when it did. */
  let refusal: string | undefined;

  for (let turn = 1; turn <= turns; turn += 1) {
    // Re-read every turn: after the first, the files carry this task's own previous attempt, which
    // is exactly what the model has to see to correct it.
    const reuse = turn === 1 ? options.prepared : undefined;
    let files: ExecutionFile[];
    let proposal: ChangeProposal;
    try {
      files = reuse?.files ?? (await readTaskFiles(root, task));
      proposal =
        reuse?.proposal ??
        (await buildTaskProposal(client, root, spec, plan, task, feedback, policy, graph, {
          ...stage,
          files,
        }));
    } catch (error) {
      // A turn that cannot even be drawn ends the loop rather than the task. Anything already
      // applied stays applied and is judged on its own merits — and if nothing has been applied
      // yet there is no work to judge, so the failure travels on as it always did.
      if (!last) {
        await restoreFiles(root, backup);
        throw error;
      }
      return exhausted(turn - 1);
    }

    if (proposal.status === "blocked") {
      await restoreFiles(root, backup);
      return { kind: "blocked", proposal };
    }

    try {
      backup = foldBackup(backup, await applyProposal(root, proposal));
    } catch (error) {
      // Nothing of this turn landed, so restore whatever earlier turns wrote and let the caller
      // decide, rather than leaving a half-applied task behind.
      await restoreFiles(root, backup);
      throw new WorkspaceMovedError(error);
    }

    const verification = await runVerification(root, task, {
      policy,
      ...((await commandsApproved()) ? {} : { approve: async () => false }),
    });
    last = { proposal, files, verification };
    options.onTurn?.(turn, verification);

    if (verificationSatisfied(task, policy, verification)) {
      // Remembered before the reviewer is consulted, so a later turn that cannot be drawn at all
      // falls back to work that did come out right instead of discarding it.
      satisfied = last;
      // The commands agree; now the read-only reviewer looks at what actually ran. A rejection here
      // is not a wasted draw, it is the next turn's instruction.
      refusal = await reviewObjection(client, proposal, {
        spec,
        plan,
        task,
        policy,
        graph,
        stage,
        files,
      });
      if (!refusal) return { kind: "settled", turn: last, backup, turns: turn };
      if (turn === turns) return exhausted(turn);
      feedback =
        "Your change was applied and its verification came out as required, but the code review " +
        `rejected it:\n\n${refusal}\n\nCorrect exactly that, within the same approved scope. If ` +
        "you are certain the review is mistaken and the change is already right, say so in summary " +
        "and return the change otherwise unaltered.";
      continue;
    }
    if (inherited(baseline, verification)) {
      return {
        kind: "settled",
        turn: { ...last, verification: annotate(verification) },
        backup,
        turns: turn,
      };
    }
    feedback = turnFeedback(verification, turn, turns);
  }

  return exhausted(turns);

  /**
   * Ends the loop on the best evidence it has.
   *
   * A turn whose commands came out as required is a real result, and it used to be discarded
   * whenever a later turn failed to produce anything at all — the task was reported as failed while
   * its own journal carried a transcript showing exactly the outcome that had been asked for. When
   * the reviewer is what refused, that is recorded too: a green transcript under a failed task is
   * otherwise impossible to explain.
   */
  function exhausted(turnCount: number): AgentOutcome {
    const best = satisfied ?? last;
    if (!best) throw new Error(`Task ${task.id} produced no proposal`);
    return {
      kind: "exhausted",
      turn: refusal
        ? { ...best, verification: noteReviewRefusal(best.verification, refusal) }
        : best,
      backup,
      turns: turnCount,
    };
  }
}

/** Runs the reviewer and returns its objection, or nothing when it passed. */
async function reviewObjection(
  client: Pick<ModelClient, "generateObject">,
  proposal: ChangeProposal,
  context: {
    spec: Spec;
    plan: ImplementationPlan;
    task: Task;
    policy: Policy;
    graph: Task[];
    stage: ProposalContext;
    files: ExecutionFile[];
  },
): Promise<string | undefined> {
  const { spec, plan, task, policy, graph, stage, files } = context;
  try {
    await reviewProposal(client, proposal, {
      ...reviewContextFor(spec, plan, task, policy, graph, stage),
      files,
    });
    return undefined;
  } catch (error) {
    // An exhausted budget is not an objection to the code.
    rethrowIfFatal(error);
    return error instanceof Error ? error.message : String(error);
  }
}

async function confirmAll(
  task: Task,
  approve: (item: Task["verification"][number]) => Promise<boolean>,
): Promise<boolean> {
  for (const item of task.verification) {
    if (!(await approve(item))) return false;
  }
  return true;
}

/**
 * What the model is told between turns.
 *
 * The real output of the real command, not a summary of it: the whole reason for the loop is that
 * the model reads what happened instead of being told about it.
 */
function turnFeedback(verification: Verification, turn: number, turns: number): string {
  const failed = verification.filter((item) => item.exit_code !== 0);
  const transcript = failed
    .map(
      (item) => `$ ${item.program} ${item.args.join(" ")}\nexit ${item.exit_code}\n${item.output}`,
    )
    .join("\n\n");
  const green = failed.length === 0;
  return [
    `Your change was applied and its verification ran. Attempt ${turn} of ${turns}.`,
    green
      ? "Every command exited zero, which is not the outcome this task requires. Re-read expectation."
      : `The verification did not come out as expectation requires:\n\n${transcript}`,
    "The files you are given now contain your previous attempt. Correct it within the same approved",
    "scope — do not start over, and do not widen the scope to work around the failure.",
  ].join("\n");
}

/**
 * Whether this failure is the one the task walked into, rather than one it caused.
 *
 * Deliberately strict — same command, same exit code — so a task that breaks the build in a new way
 * is still caught, and it is only ever consulted once the run has deliberately left the suite red.
 *
 * A command that never ran cannot be inherited from. Matching on the exit code alone let a missing
 * binary absolve itself: 127 before and 127 after look identical, and the task was recorded as
 * completed having verified nothing at all. `ranToCompletion` is the same line test-first already
 * draws, which is why it is drawn once.
 */
function inherited(baseline: Verification | undefined, verification: Verification): boolean {
  if (!baseline) return false;
  const failed = verification.find((item) => item.exit_code !== 0);
  if (!failed || !ranToCompletion(failed)) return false;
  const before = baseline.find(
    (item) => item.program === failed.program && item.args.join(" ") === failed.args.join(" "),
  );
  return before !== undefined && before.exit_code === failed.exit_code;
}

/** Records that the commands were satisfied and the review was not. */
function noteReviewRefusal(verification: Verification, objection: string): Verification {
  return [
    ...verification,
    {
      program: "sddc",
      args: ["review"],
      exit_code: 1,
      timed_out: false,
      output: `Verification came out as required, but the code review refused the result:\n${objection}`,
    },
  ];
}

/** Keeps the journal honest about why a failing command was not held against the task. */
function annotate(verification: Verification): Verification {
  return verification.map((item) =>
    item.exit_code === 0
      ? item
      : {
          ...item,
          output: `${item.output}\n[this command failed the same way before the task ran; not attributed to it]`,
        },
  );
}

/** Keeps the earliest recorded state for every path, so one restore undoes every turn. */
function foldBackup(first: FileBackup, next: FileBackup): FileBackup {
  const files = new Map(next.files);
  for (const [path, content] of first.files) files.set(path, content);
  return {
    files,
    directories: [...new Set([...first.directories, ...next.directories])],
  };
}
