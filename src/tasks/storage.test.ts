import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStoredTaskList, readTaskList, writeTaskList } from "./storage";
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

test("a task graph written before files.delete existed still loads", () => {
  // A stored graph outlives the schema that produced it. The eval corpus broke the moment the field
  // was added, which is the same lesson readPolicy learned by merging over its defaults.
  const stored = {
    status: "ready",
    feature: "registration",
    summary: "One task",
    tasks: [
      {
        id: "T1",
        title: "Implement",
        goal: "Add it",
        requirements: ["R1"],
        acceptance: ["A1"],
        depends_on: [],
        permissions: [],
        files: { read: [], modify: ["src/auth.ts"], create: [] },
        verification: [{ command: { program: "bun", args: ["test"] }, purpose: "Suite" }],
        done_when: ["done"],
        risks: [],
        wave: 1,
        parallel: false,
      },
    ],
    questions: [],
  };

  const list = parseStoredTaskList(stored);

  expect(list.tasks[0]?.files.delete).toEqual([]);
  // Nothing else about the stored graph is touched, so a case keeps testing what it recorded.
  expect(list.tasks[0]?.files.modify).toEqual(["src/auth.ts"]);
});
