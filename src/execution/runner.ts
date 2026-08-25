import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { orderTasks } from "../tasks/validate";
import { createGitCheckpoint } from "./checkpoint";
import { groupByWave, prefetchable } from "./concurrency";
import { type FileBackup, restoreFiles } from "./files";
import type { ProposalContext } from "./pipeline";
import { validateResume } from "./resume";
import type { ChangeProposal, ExecutionJournal, ExecutionTaskResult } from "./schemas";
import { loadExecutionJournal, writeExecutionJournal } from "./storage";
import { executeTask, prepareTask, type TaskPreparation } from "./task-executor";

type ReviewResult = { accepted: true } | { accepted: false; feedback: string };
type FinalReview = { accepted: true } | { accepted: false; taskId: string; feedback: string };
type AfterTaskAction = "continue" | "checkpoint" | "rollback";

export type ExecutionHooks = {
  approveScope?(task: Task): Promise<boolean>;
  review(task: Task, proposal: ChangeProposal, diff: string): Promise<ReviewResult>;
  proposalBlocked?(task: Task, proposal: ChangeProposal): void;
  approveSensitive?(task: Task): Promise<boolean>;
  approveCommand?(task: Task, verification: Task["verification"][number]): Promise<boolean>;
  /** Called after each turn of a task's agent loop, so a long task is not a silent one. */
  taskProgress?(task: Task, turn: number, verification: ExecutionTaskResult["verification"]): void;
  retryAfterFailure(task: Task, result: ExecutionTaskResult): Promise<boolean>;
  afterTask?(task: Task, result: ExecutionTaskResult): Promise<AfterTaskAction>;
  finalReview?(journal: ExecutionJournal, revisableTaskIds: string[]): Promise<FinalReview>;
  resumeExisting?(journal: ExecutionJournal): Promise<boolean>;
  taskCompleted?(result: ExecutionTaskResult): void;
};

/**
 * Generates proposals for independent tasks of a wave while the current one is being reviewed.
 *
 * Model latency dominates a run, and the tasks of a wave are independent by construction. Only the
 * generation is shared out: writing, verifying and approving stay strictly ordered, so the terminal
 * never has to host two conversations at once.
 *
 * Strict mode never prefetches — it exists so the user authorizes each task before any work happens
 * on it, and spending a model call ahead of that approval would defeat the mode.
 */
function createPrefetcher(
  client: Pick<ModelClient, "generateObject">,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  ordered: Task[],
  policy: Policy,
  mode: ExecutionJournal["mode"],
  stage: () => ProposalContext,
) {
  const pending = new Map<string, Promise<TaskPreparation>>();
  const released = new Set<number>();
  const waves = groupByWave(ordered);

  return {
    schedule(wave: number): void {
      if (mode === "strict" || released.has(wave)) return;
      released.add(wave);
      const group = waves.find((tasks) => tasks[0]?.wave === wave) ?? [];
      // The first task of the wave is about to run inline; only its siblings are worth prefetching.
      for (const task of prefetchable(group).slice(1)) {
        const work = prepareTask(client, root, spec, plan, task, "", policy, ordered, stage());
        // A prefetch that fails must surface when the task is reached, not as an unhandled rejection.
        work.catch(() => undefined);
        pending.set(task.id, work);
      }
    },
    async take(taskId: string): Promise<TaskPreparation | undefined> {
      const work = pending.get(taskId);
      if (!work) return undefined;
      pending.delete(taskId);
      // A failed prefetch is not a failed task: fall back to generating it inline.
      return work.catch(() => undefined);
    },
  };
}

/** Records a task whose proposal could never be produced, so the run ends as a journal, not a stack. */
function unproducible(task: Task, reason: string): ExecutionTaskResult {
  return {
    task_id: task.id,
    status: "failed",
    changed_files: [],
    verification: [
      {
        program: "sddc",
        args: ["propose"],
        exit_code: 1,
        timed_out: false,
        output: `No usable proposal for ${task.id}:\n${reason}`,
      },
    ],
    output_hashes: [],
    checkpoint: null,
  };
}

/** Records a task the run gave up on, so the journal names it rather than ending silently. */
function exhausted(task: Task, used: number, feedback: string): ExecutionTaskResult {
  return {
    task_id: task.id,
    status: "failed",
    changed_files: [],
    verification: [
      {
        program: "sddc",
        args: ["attempts"],
        exit_code: 1,
        timed_out: false,
        output: `Gave up on ${task.id} after ${used} attempts. Last reason:\n${feedback}`,
      },
    ],
    output_hashes: [],
    checkpoint: null,
  };
}

export async function executePlan(
  client: Pick<ModelClient, "generateObject">,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  tasks: Task[],
  hooks: ExecutionHooks,
  policy: Policy = defaultPolicy,
  mode = policy.execution.default_approval_mode,
  resumeJournal?: ExecutionJournal,
  upstream: Pick<ProposalContext, "constitution" | "clarifications"> = {},
): Promise<ExecutionJournal> {
  const ordered = orderTasks(tasks);
  const existing = resumeJournal ?? (await loadExecutionJournal(root, plan.feature));
  if (existing?.status === "completed" && !resumeJournal) {
    await validateResume(root, existing);
    return existing;
  }
  let journal: ExecutionJournal = {
    feature: plan.feature,
    status: "in_progress",
    mode,
    pending_feedback: null,
    tasks: [],
  };
  if (
    existing &&
    existing.status !== "completed" &&
    (resumeJournal || (await hooks.resumeExisting?.(existing)))
  ) {
    await validateResume(root, existing);
    journal = { ...existing, status: "in_progress", mode };
    journal.tasks = journal.tasks.filter((task) => task.status === "completed");
  }
  await writeExecutionJournal(root, journal);

  const completed = new Set(
    journal.tasks.filter((task) => task.status === "completed").map((task) => task.task_id),
  );
  const backups = new Map<string, FileBackup>();
  const feedback = new Map<string, string>();
  const attempts = new Map<string, number>();
  // Rebuilt per call rather than captured, so a task always sees which siblings have really landed.
  const stage = (): ProposalContext => ({
    ...upstream,
    completed: new Set(completed),
    // A completed task with a failing command is the red-by-design test task of Article III; from
    // there on, the suite its siblings run is red for a reason none of them caused.
    suiteRedByDesign: journal.tasks.some(
      (item) =>
        item.status === "completed" && item.verification.some((check) => check.exit_code !== 0),
    ),
  });
  const prefetch = createPrefetcher(client, root, spec, plan, ordered, policy, mode, stage);
  if (journal.pending_feedback) {
    feedback.set(journal.pending_feedback.task_id, journal.pending_feedback.feedback);
    journal.pending_feedback = null;
  }
  /**
   * Books another attempt at a task, and says whether the run has spent them all.
   *
   * Every path that sends a task round again goes through here — a failed verification, a rejected
   * diff, a rolled-back result. Bounding only some of them left the others able to loop forever,
   * which is precisely the hole the bound was added to close.
   */
  const retryTask = (task: Task, reason: string): boolean => {
    const used = (attempts.get(task.id) ?? 1) + 1;
    if (used > policy.execution.max_task_attempts) {
      journal.status = "failed";
      journal.tasks.push(exhausted(task, used - 1, reason));
      return false;
    }
    attempts.set(task.id, used);
    feedback.set(task.id, reason);
    return true;
  };
  let index = 0;

  while (index < ordered.length) {
    const task = ordered[index];
    if (!task) break;
    if (completed.has(task.id)) {
      index += 1;
      continue;
    }
    if (hooks.approveScope && !(await hooks.approveScope(task))) {
      journal.status = "blocked";
      await writeExecutionJournal(root, journal);
      return journal;
    }

    const pending = feedback.get(task.id) ?? "";
    // Arriving at a task is what releases its wave: everything before it has already been written,
    // so the files its siblings read are settled.
    prefetch.schedule(task.wave);
    // Every model call under here is already retried and sampled; when it still comes back with
    // nothing usable — a budget spent on a refusal the validator keeps rejecting, a provider that
    // stays down — that is this task failing, not the program crashing. The user gets a journal
    // naming the task and the reason, and every task completed before it stays on disk.
    let outcome: Awaited<ReturnType<typeof executeTask>>;
    try {
      outcome = await executeTask(
        client,
        root,
        spec,
        plan,
        task,
        hooks,
        policy,
        mode,
        pending,
        // A retry carries new feedback, so the proposal generated before it is no longer the answer.
        pending ? undefined : await prefetch.take(task.id),
        ordered,
        stage(),
      );
    } catch (error) {
      journal.status = "failed";
      journal.tasks.push(unproducible(task, describe(error)));
      await writeExecutionJournal(root, journal);
      return journal;
    }
    if (outcome.kind === "blocked") {
      hooks.proposalBlocked?.(task, outcome.proposal);
      journal.status = "blocked";
      await writeExecutionJournal(root, journal);
      return journal;
    }
    if (outcome.kind === "failed") {
      journal.status = "failed";
      journal.tasks.push(outcome.result);
      await writeExecutionJournal(root, journal);
      return journal;
    }
    if (outcome.kind === "retry") {
      if (!retryTask(task, outcome.feedback)) {
        await writeExecutionJournal(root, journal);
        return journal;
      }
      continue;
    }

    const action = (await hooks.afterTask?.(task, outcome.result)) ?? "continue";
    if (action === "rollback") {
      await restoreFiles(root, outcome.backup);
      if (
        !retryTask(task, "User rolled back the verified proposal and requested another version.")
      ) {
        await writeExecutionJournal(root, journal);
        return journal;
      }
      continue;
    }
    if (action === "checkpoint") {
      if (!policy.execution.allow_git_checkpoints) {
        await restoreFiles(root, outcome.backup);
        throw new Error("Git checkpoints are disabled by project policy");
      }
      outcome.result.checkpoint = await createGitCheckpoint(
        root,
        task.id,
        outcome.result.changed_files,
      );
      backups.clear();
    } else {
      backups.set(task.id, outcome.backup);
    }
    completed.add(task.id);
    journal.tasks.push(outcome.result);
    await writeExecutionJournal(root, journal);
    hooks.taskCompleted?.(outcome.result);
    index += 1;
  }

  journal.status = "awaiting_acceptance";
  await writeExecutionJournal(root, journal);
  const final = (await hooks.finalReview?.(journal, [...backups.keys()])) ?? { accepted: true };
  if (!final.accepted) {
    const target = ordered.findIndex((task) => task.id === final.taskId);
    if (target < 0 || !backups.has(final.taskId)) {
      throw new Error(`Task ${final.taskId} cannot be revised in this execution session`);
    }
    for (let rollback = ordered.length - 1; rollback >= target; rollback -= 1) {
      const task = ordered[rollback];
      if (!task) continue;
      const backup = backups.get(task.id);
      if (backup) await restoreFiles(root, backup);
      backups.delete(task.id);
      completed.delete(task.id);
    }
    journal.tasks = journal.tasks.filter((item) => completed.has(item.task_id));
    journal.status = "in_progress";
    journal.pending_feedback = { task_id: final.taskId, feedback: final.feedback };
    await writeExecutionJournal(root, journal);
    return executePlan(client, root, spec, plan, tasks, hooks, policy, mode, journal, upstream);
  }

  journal.status = "completed";
  await writeExecutionJournal(root, journal);
  return journal;
}

/** The message plus its cause: the sampling failure that matters is usually the wrapped one. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : `: ${String(error.cause)}`;
  return `${error.message}${cause}`.slice(0, 2_000);
}
