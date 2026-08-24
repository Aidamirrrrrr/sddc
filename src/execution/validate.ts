import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Task } from "../tasks/schemas";
import type { ExecutionFile } from "./context";
import type { ChangeProposal } from "./schemas";

export function validateProposal(
  proposal: ChangeProposal,
  task: Task,
  files: ExecutionFile[],
  policy: Policy = defaultPolicy,
): void {
  if (proposal.task_id !== task.id)
    throw new Error(`Proposal targets ${proposal.task_id}, not ${task.id}`);
  if (proposal.status === "blocked") {
    if (!proposal.blocker) throw new Error(`${task.id} blocked proposal has no blocker`);
    if (proposal.changes.length > 0)
      throw new Error(`${task.id} blocked proposal contains changes`);
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
  for (const criterion of [...task.requirements, ...task.acceptance]) {
    const paths = traced.get(criterion);
    if (!paths || [...paths].some((path) => !seen.has(path))) {
      throw new Error(`${task.id} has invalid traceability for ${criterion}`);
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
