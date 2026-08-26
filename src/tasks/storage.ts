import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { taskMarkdown } from "../artifacts/markdown";
import { readArtifact } from "../spec/storage";
import { type TaskList, taskListSchema } from "./schemas";

export async function writeTaskList(list: TaskList, root = process.cwd()): Promise<string> {
  const directory = join(root, ".specs", list.feature);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "tasks.yaml");
  await Bun.write(path, Bun.YAML.stringify(list, null, 2));
  await Bun.write(join(directory, "tasks.md"), taskMarkdown(list));
  return path;
}

export async function readTaskList(root: string, feature: string): Promise<TaskList> {
  return parseStoredTaskList(await readArtifact(root, feature, "tasks.yaml"));
}

/**
 * Reads a task graph written by any version of this tool.
 *
 * A stored graph outlives the schema that produced it. Demanding today's complete shape from a file
 * written before a field existed invalidates every artifact at once — which is exactly what
 * happened to the eval corpus the moment `files.delete` was added, and what `readPolicy` already
 * learned to avoid by merging over its defaults. Only absent lists are filled; nothing else about
 * the stored graph is touched, so a case keeps testing what it was recorded to test.
 *
 * The model-facing schema stays strict. This is about what may be *read*, not what may be returned.
 */
export function parseStoredTaskList(value: unknown): TaskList {
  return taskListSchema.parse(backfillFileLists(value));
}

function backfillFileLists(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const list = value as { tasks?: unknown };
  if (!Array.isArray(list.tasks)) return value;
  return {
    ...list,
    tasks: list.tasks.map((task) => {
      if (typeof task !== "object" || task === null) return task;
      const files = (task as { files?: Record<string, unknown> }).files;
      if (typeof files !== "object" || files === null) return task;
      return {
        ...task,
        files: { read: [], modify: [], create: [], delete: [], ...files },
      };
    }),
  };
}
