import type { ModelClient } from "../ai/model-client";
import type { ImplementationPlan } from "../planning/schemas";
import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Spec } from "../spec/schemas";
import { createGitCheckpoint } from "./checkpoint";
import { type FileBackup, restoreFiles } from "./files";
import { orderTasks } from "./pipeline";
import { validateResume } from "./resume";
import type { ChangeProposal, ExecutionJournal, ExecutionTaskResult } from "./schemas";
import { loadExecutionJournal, writeExecutionJournal } from "./storage";
import { executeTask } from "./task-executor";

type ReviewResult = { accepted: true } | { accepted: false; feedback: string };
type FinalReview = { accepted: true } | { accepted: false; taskId: string; feedback: string };
type AfterTaskAction = "continue" | "checkpoint" | "rollback";

export type ExecutionHooks = {
  approveScope?(task: ImplementationPlan["tasks"][number]): Promise<boolean>;
  review(
    task: ImplementationPlan["tasks"][number],
    proposal: ChangeProposal,
    diff: string,
  ): Promise<ReviewResult>;
  proposalBlocked?(task: ImplementationPlan["tasks"][number], proposal: ChangeProposal): void;
  approveSensitive?(task: ImplementationPlan["tasks"][number]): Promise<boolean>;
  approveCommand?(
    task: ImplementationPlan["tasks"][number],
    verification: ImplementationPlan["tasks"][number]["verification"][number],
  ): Promise<boolean>;
  retryAfterFailure(
    task: ImplementationPlan["tasks"][number],
    result: ExecutionTaskResult,
  ): Promise<boolean>;
  afterTask?(
    task: ImplementationPlan["tasks"][number],
    result: ExecutionTaskResult,
  ): Promise<AfterTaskAction>;
  finalReview?(journal: ExecutionJournal, revisableTaskIds: string[]): Promise<FinalReview>;
  resumeExisting?(journal: ExecutionJournal): Promise<boolean>;
  taskCompleted?(result: ExecutionTaskResult): void;
};

export async function executePlan(
  client: Pick<ModelClient, "generateObject">,
  root: string,
  spec: Spec,
  plan: ImplementationPlan,
  hooks: ExecutionHooks,
  policy: Policy = defaultPolicy,
  mode = policy.execution.default_approval_mode,
  resumeJournal?: ExecutionJournal,
): Promise<ExecutionJournal> {
  const ordered = orderTasks(plan);
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
  if (journal.pending_feedback) {
    feedback.set(journal.pending_feedback.task_id, journal.pending_feedback.feedback);
    journal.pending_feedback = null;
  }
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

    const outcome = await executeTask(
      client,
      root,
      spec,
      plan,
      task,
      hooks,
      policy,
      mode,
      feedback.get(task.id) ?? "",
    );
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
      feedback.set(task.id, outcome.feedback);
      continue;
    }

    const action = (await hooks.afterTask?.(task, outcome.result)) ?? "continue";
    if (action === "rollback") {
      await restoreFiles(root, outcome.backup);
      feedback.set(
        task.id,
        "User rolled back the verified proposal and requested another version.",
      );
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
    return executePlan(client, root, spec, plan, hooks, policy, mode, journal);
  }

  journal.status = "completed";
  await writeExecutionJournal(root, journal);
  return journal;
}
