import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTaskList, writeTaskList } from "./storage";
import { readyTasks } from "./test-fixtures";

test("a stored task graph is read back with its waves intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-tasks-storage-"));
  const list = readyTasks();

  const path = await writeTaskList(list, root);
  const restored = await readTaskList(root, list.feature);

  expect(path.endsWith(join(".specs", "registration", "tasks.yaml"))).toBe(true);
  expect(restored).toEqual(list);
});

test("reading a feature that was never compiled names the missing artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-tasks-missing-"));

  expect(readTaskList(root, "registration")).rejects.toThrow("Missing artifact");
});
