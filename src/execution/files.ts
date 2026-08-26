import { lstat, mkdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sha256 } from "./context";
import type { ChangeProposal } from "./schemas";

/**
 * Everything needed to put the workspace back exactly as it was.
 *
 * The directories are recorded rather than inferred at restore time, because "empty once the files
 * are removed" is a different question from "was not there before". A directory that already existed
 * and already happened to be empty is not this task's to delete, and only the pre-state knows which
 * is which.
 */
export type FileBackup = {
  /** Contents before the change; `null` for a file that did not exist. */
  files: Map<string, string | null>;
  /** Directories the change had to create, relative to the root. */
  directories: string[];
};

export function emptyBackup(): FileBackup {
  return { files: new Map(), directories: [] };
}

export async function applyProposal(root: string, proposal: ChangeProposal): Promise<FileBackup> {
  const backup = emptyBackup();
  const created = new Set<string>();
  for (const change of proposal.changes) {
    await assertSafeDestination(root, change.path);
    const path = join(root, change.path);
    const file = Bun.file(path);
    const exists = await file.exists();
    const content = exists ? await file.text() : null;
    if (change.operation === "modify" && sha256(content ?? "") !== change.expected_sha256) {
      throw new Error(`File changed after proposal was created: ${change.path}`);
    }
    if (change.operation === "create" && exists) {
      throw new Error(`File was created after proposal was created: ${change.path}`);
    }
    backup.files.set(change.path, content);
    for (const directory of await absentDirectories(root, change.path)) created.add(directory);
  }
  backup.directories = [...created];
  try {
    for (const change of proposal.changes) {
      const path = join(root, change.path);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.sddc-${crypto.randomUUID()}.tmp`;
      await Bun.write(temporary, change.content);
      await rename(temporary, path);
    }
    return backup;
  } catch (error) {
    await restoreFiles(root, backup);
    throw new Error(`Failed to apply task ${proposal.task_id}`, { cause: error });
  }
}

async function assertSafeDestination(root: string, path: string): Promise<void> {
  const rootPath = resolve(root);
  const destination = resolve(rootPath, path);
  const fromRoot = relative(rootPath, destination);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe destination path: ${path}`);
  }

  let current = rootPath;
  for (const part of fromRoot.split(/[\\/]/)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Symbolic links are not writable: ${path}`);
      }
    } catch (error) {
      if (isMissingFileError(error)) break;
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function restoreFiles(root: string, backup: FileBackup): Promise<void> {
  for (const [changed, content] of backup.files) {
    const path = join(root, changed);
    if (content === null) {
      await rm(path, { force: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, content);
    }
  }
  // Deepest first, so a nested directory is gone before the one holding it is tried. Anything still
  // inside belongs to somebody else, and rmdir refusing to remove it is the right answer rather than
  // something to work around.
  const deepestFirst = [...backup.directories].sort(
    (left, right) => right.split("/").length - left.split("/").length,
  );
  for (const directory of deepestFirst) {
    await rmdir(join(root, directory)).catch(() => undefined);
  }
}

/** Ancestor directories of `path` that do not exist yet, shallowest first. */
async function absentDirectories(root: string, path: string): Promise<string[]> {
  const parts = path.split(/[\\/]/).slice(0, -1);
  const absent: string[] = [];
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (await isDirectory(join(root, current))) continue;
    absent.push(current);
  }
  return absent;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
