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
  return taskListSchema.parse(await readArtifact(root, feature, "tasks.yaml"));
}
