import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { type ExecutionFile, readTaskFiles } from "./context";
import { applyProposal, type FileBackup, restoreFiles } from "./files";
import { buildTaskProposal, type ProposalContext, reviewContextFor } from "./pipeline";
import { reviewProposal } from "./review";
import type { ChangeProposal, ExecutionTaskResult } from "./schemas";
import { verificationSatisfied } from "./task-executor";
import { runVerification } from "./verify";

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
  // Taken once, before anything is written, and only when this run has already left the suite red on
  // purpose. A task is answerable for what its change broke, not for what was broken when it
  // arrived — and without this the loop asks a task with nothing left to fix to fix something,
  // which it answers by returning the same file and being rejected for not changing it.
  const baseline = stage.suiteRedByDesign
    ? await runVerification(root, task, { policy }).catch(() => undefined)
    : undefined;
  let backup: FileBackup = new Map();
  let feedback = options.feedback;
  let last: AgentTurn | undefined;
  let approved: boolean | undefined;

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
      return { kind: "exhausted", turn: last, backup, turns: turn - 1 };
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

    // The command was approved for this task, not for this turn; asking again every turn would make
    // strict mode unusable without making it any stricter.
    if (options.approveCommand && approved === undefined) {
      approved = await confirmAll(task, options.approveCommand);
    }
    const verification = await runVerification(root, task, {
      policy,
      ...(approved === false ? { approve: async () => false } : {}),
    });
    last = { proposal, files, verification };
    options.onTurn?.(turn, verification);

    if (verificationSatisfied(task, policy, verification)) {
      // The commands agree; now the read-only reviewer looks at what actually ran. A rejection here
      // is not a wasted draw, it is the next turn's instruction.
      const objection = await reviewObjection(client, proposal, {
        spec,
        plan,
        task,
        policy,
        graph,
        stage,
        files,
      });
      if (!objection) return { kind: "settled", turn: last, backup, turns: turn };
      if (turn === turns) {
        // Say so in the journal: the commands passed, and it was the reviewer that refused. Reading
        // a green transcript under a failed task is otherwise impossible to explain.
        return {
          kind: "exhausted",
          turn: { ...last, verification: noteReviewRefusal(verification, objection) },
          backup,
          turns: turn,
        };
      }
      feedback = `Your change was applied and its verification came out as required, but the code review rejected it:\n\n${objection}\n\nCorrect it within the same approved scope.`;
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

  if (!last) throw new Error(`Task ${task.id} produced no proposal`);
  return { kind: "exhausted", turn: last, backup, turns };
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
 */
function inherited(baseline: Verification | undefined, verification: Verification): boolean {
  if (!baseline) return false;
  const failed = verification.find((item) => item.exit_code !== 0);
  if (!failed || failed.timed_out) return false;
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
  const folded = new Map(next);
  for (const [path, content] of first) folded.set(path, content);
  return folded;
}
