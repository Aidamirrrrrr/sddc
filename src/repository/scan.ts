import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".specs",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);
const MAX_INDEXED_FILES = 5_000;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 200 * 1024;

export type RepositoryFile = { path: string; size: number };
export type FileSnapshot = RepositoryFile & { content: string };

export async function indexRepository(root: string): Promise<RepositoryFile[]> {
  const files: RepositoryFile[] = [];
  await walk(root, root, files);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readSnapshots(
  root: string,
  index: RepositoryFile[],
  selectedPaths: string[],
): Promise<FileSnapshot[]> {
  const indexed = new Map(index.map((file) => [file.path, file]));
  const snapshots: FileSnapshot[] = [];
  let totalBytes = 0;

  for (const path of [...new Set(selectedPaths)]) {
    const file = indexed.get(path);
    if (!file || file.size > MAX_FILE_BYTES || totalBytes + file.size > MAX_SNAPSHOT_BYTES)
      continue;
    const content = await readFile(join(root, path), "utf8");
    if (content.includes("\0")) continue;
    snapshots.push({ ...file, content });
    totalBytes += file.size;
  }
  return snapshots;
}

async function walk(root: string, directory: string, files: RepositoryFile[]): Promise<void> {
  if (files.length >= MAX_INDEXED_FILES) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= MAX_INDEXED_FILES) return;
    if (entry.isSymbolicLink()) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) await walk(root, absolutePath, files);
      continue;
    }
    if (!entry.isFile() || isSensitive(entry.name)) continue;
    const metadata = await stat(absolutePath);
    files.push({ path: relative(root, absolutePath).split(sep).join("/"), size: metadata.size });
  }
}

function isSensitive(name: string): boolean {
  const normalized = basename(name).toLocaleLowerCase();
  if (normalized === ".env" || normalized.startsWith(".env.")) {
    return normalized !== ".env.example";
  }
  return (
    normalized.endsWith(".pem") ||
    normalized.endsWith(".key") ||
    normalized === "credentials" ||
    normalized.startsWith("credentials.")
  );
}
