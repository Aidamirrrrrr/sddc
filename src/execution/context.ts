import { join } from "node:path";
import { isForbiddenPath, isSafeProjectPath } from "../policy/paths";
import type { Policy } from "../policy/schemas";
import { MAX_FILE_BYTES } from "../repository/scan";
import type { Task } from "../tasks/schemas";

export type ExecutionFile = { path: string; sha256: string; content: string };

/**
 * A request to read files, from whoever is asking.
 *
 * Spelled out rather than derived from the proposal schema: the tool loop asks the same question
 * with a different shape, and tying the grant to one caller's schema would mean changing the grant
 * whenever that caller changes.
 */
export type FileRequest = { reason: string; paths: Array<{ path: string; reason: string }> };

/** What came of a read request: what the task may now see, and why the rest was refused. */
export type FileGrant = { granted: ExecutionFile[]; refusals: string[] };

/**
 * Answers a task's request to read a file it was not granted.
 *
 * The host decides, which is the whole point: the model names paths and this reads back only the
 * ones that pass the same rules the task graph itself was held to. Nothing here can widen what the
 * task may *write* — the result is context for the next draw and nothing else.
 *
 * A refusal is not a failure. It travels back as the next draw's feedback, saying which path was
 * refused and why, so the model can ask for something else or proceed without it.
 */
export async function grantRequestedFiles(
  root: string,
  request: FileRequest,
  policy: Policy,
  visible: Set<string>,
): Promise<FileGrant> {
  const granted: ExecutionFile[] = [];
  const refusals: string[] = [];
  const seen = new Set(visible);

  for (const item of request.paths) {
    const path = item.path;
    if (seen.has(path)) {
      refusals.push(`${path} was already supplied to you; re-read the files you were given.`);
      continue;
    }
    seen.add(path);
    if (!isSafeProjectPath(path)) {
      refusals.push(`${path} is not a path this tool will read.`);
      continue;
    }
    if (isForbiddenPath(path, policy.changes.forbid_paths)) {
      refusals.push(`${path} is forbidden by the project policy.`);
      continue;
    }
    const file = Bun.file(join(root, path));
    if (!(await file.exists())) {
      refusals.push(`${path} does not exist in this repository.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      refusals.push(`${path} is too large to supply.`);
      continue;
    }
    const content = await file.text();
    if (content.includes("\0")) {
      refusals.push(`${path} is not a text file.`);
      continue;
    }
    granted.push({ path, content, sha256: sha256(content) });
  }
  // Writable paths are the task's own and are never widened here; a granted file is readable only.
  return { granted, refusals };
}

export async function readTaskFiles(root: string, task: Task): Promise<ExecutionFile[]> {
  const paths = [...new Set([...task.files.read, ...task.files.modify])];
  return Promise.all(
    paths.map(async (path) => {
      const file = Bun.file(join(root, path));
      if (!(await file.exists())) throw new Error(`Task ${task.id} requires missing file: ${path}`);
      const content = await file.text();
      return { path, content, sha256: sha256(content) };
    }),
  );
}

export function sha256(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}
