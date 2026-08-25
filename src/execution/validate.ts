import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Task } from "../tasks/schemas";
import type { ExecutionFile } from "./context";
import type { ChangeProposal } from "./schemas";

/**
 * Checks the model's refusal, not just its work.
 *
 * A blocker stops the run and sends the user back to replanning, so a false one is expensive. The
 * failure seen in practice is a task refusing itself: claiming a file is outside its scope when the
 * task already lists that file as writable. Nothing upstream can fix that, because there is nothing
 * to fix — so it is rejected here and goes through the ordinary one-revision repair instead.
 */
function validateBlocker(
  blocker: NonNullable<ChangeProposal["blocker"]>,
  task: Task,
  graph: Task[],
): void {
  if (blocker.required_files.length === 0) return;
  const writable = [...task.files.modify, ...task.files.create];
  const granted = new Set(writable);
  const alreadyGranted = blocker.required_files.filter((path) => granted.has(path));
  if (alreadyGranted.length === blocker.required_files.length) {
    // This message becomes the repair turn's validation_error, so it states the fact that
    // contradicts the refusal. Naming the error alone was measured to leave the model blocking.
    throw new Error(
      `${task.id} blocked on files it may already write: ${alreadyGranted.join(", ")}. ` +
        `The task grants write access to ${writable.join(", ")}, so the approved scope is ` +
        "sufficient and a blocker is wrong. Return the change instead.",
    );
  }

  // The other false refusal, seen every time test-first was switched on: a test task refuses because
  // the function it must call does not exist yet, when the very next task in the graph creates it.
  // The task is asking for the plan to be undone. Whether a sibling owns the file is a fact about
  // the graph, so it is settled here rather than argued about in a prompt.
  const owners = new Map<string, string[]>();
  for (const other of graph) {
    if (other.id === task.id) continue;
    for (const path of [...other.files.modify, ...other.files.create]) {
      owners.set(path, [...(owners.get(path) ?? []), other.id]);
    }
  }
  const ownedElsewhere = blocker.required_files.filter((path) => owners.has(path));
  if (ownedElsewhere.length === blocker.required_files.length) {
    const detail = ownedElsewhere
      .map((path) => `${path} (owned by ${owners.get(path)?.join(", ")})`)
      .join(", ");
    throw new Error(
      `${task.id} blocked on files another task in this graph already owns: ${detail}. ` +
        "Those files are not missing, they are simply not written yet, and taking them over " +
        "would undo the accepted plan. Code your task must reference may legitimately not exist " +
        "yet — write your slice against it as it will be, and return the change instead.",
    );
  }
}

export function validateProposal(
  proposal: ChangeProposal,
  task: Task,
  files: ExecutionFile[],
  policy: Policy = defaultPolicy,
  graph: Task[] = [task],
): void {
  if (proposal.task_id !== task.id)
    throw new Error(`Proposal targets ${proposal.task_id}, not ${task.id}`);
  if (proposal.status === "blocked") {
    if (!proposal.blocker) throw new Error(`${task.id} blocked proposal has no blocker`);
    if (proposal.changes.length > 0)
      throw new Error(`${task.id} blocked proposal contains changes`);
    validateBlocker(proposal.blocker, task, graph);
    return;
  }
  if (proposal.blocker) throw new Error(`${task.id} ready proposal contains a blocker`);
  if (proposal.changes.length === 0) throw new Error(`${task.id} proposal contains no changes`);

  const modify = new Set(task.files.modify);
  const create = new Set(task.files.create);
  const snapshots = new Map(files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  let changedLines = 0;

  for (const change of proposal.changes) {
    if (seen.has(change.path)) throw new Error(`${task.id} changes ${change.path} more than once`);
    seen.add(change.path);
    if (Buffer.byteLength(change.content) > policy.changes.max_generated_file_bytes) {
      throw new Error(`${task.id} generates an oversized file: ${change.path}`);
    }
    if (change.operation === "modify") {
      if (!modify.has(change.path)) throw new Error(`${task.id} may not modify ${change.path}`);
      const snapshot = snapshots.get(change.path);
      if (!snapshot) throw new Error(`${task.id} has no approved snapshot for ${change.path}`);
      if (change.expected_sha256 !== snapshot.sha256) {
        throw new Error(`${task.id} has a stale or invalid hash for ${change.path}`);
      }
      if (change.content === snapshot.content)
        throw new Error(`${task.id} does not change ${change.path}`);
      changedLines += approximateChangedLines(snapshot.content, change.content);
    } else {
      if (!create.has(change.path)) throw new Error(`${task.id} may not create ${change.path}`);
      if (change.expected_sha256 !== null)
        throw new Error(`${task.id} must not hash new file ${change.path}`);
      changedLines += change.content.split("\n").length;
    }
  }
  const omitted = [...modify, ...create].find((path) => !seen.has(path));
  if (omitted) throw new Error(`${task.id} omits planned change: ${omitted}`);
  const traced = new Map(
    proposal.traceability.map((item) => [item.requirement_id, new Set(item.paths)]),
  );
  const changed = [...seen].join(", ");
  for (const criterion of [...task.requirements, ...task.acceptance]) {
    const paths = traced.get(criterion);
    // The message travels to the repair turn as its validation_error, so it names what was wrong
    // rather than only that something was. "Invalid traceability for A1" left the next draw
    // guessing, and the commonest guess is to point at the file under test, which it never changed.
    if (!paths) {
      throw new Error(
        `${task.id} has no traceability entry for ${criterion}. Every requirement and acceptance ` +
          `criterion needs one, whose paths are drawn from this proposal's own changes: ${changed}`,
      );
    }
    const foreign = [...paths].filter((path) => !seen.has(path));
    if (foreign.length > 0) {
      throw new Error(
        `${task.id} traces ${criterion} to ${foreign.join(", ")}, which this proposal does not ` +
          `change. Traceability points at the files you changed (${changed}), never at a file you ` +
          "only read.",
      );
    }
  }
  if (changedLines > policy.execution.max_changed_lines_per_task) {
    throw new Error(
      `${task.id} changes approximately ${changedLines} lines; policy allows ${policy.execution.max_changed_lines_per_task}`,
    );
  }
}

function approximateChangedLines(before: string, after: string): number {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return oldLines.length - prefix - suffix + (newLines.length - prefix - suffix);
}
