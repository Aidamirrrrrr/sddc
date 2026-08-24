import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sha256 } from "./context";
import type { ChangeProposal } from "./schemas";

export type FileBackup = Map<string, string | null>;

export async function applyProposal(root: string, proposal: ChangeProposal): Promise<FileBackup> {
  const backup: FileBackup = new Map();
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
    backup.set(change.path, content);
  }
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
  for (const [relative, content] of backup) {
    const path = join(root, relative);
    if (content === null) {
      await rm(path, { force: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, content);
    }
  }
}
