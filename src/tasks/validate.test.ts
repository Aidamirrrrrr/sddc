import { expect, test } from "bun:test";
import { discovery, readySpec } from "../planning/test-fixtures";
import type { Task, TaskList } from "./schemas";
import { readyTasks } from "./test-fixtures";
import { normalizeTaskList, orderTasks, validateTaskList } from "./validate";

test("task normalization renumbers tasks and their dependencies", () => {
  const list = readyTasks();
  const [first, second] = requireTwoTasks(list);
  first.id = "setup";
  second.id = "finish";
  second.depends_on = ["setup", "setup"];

  const normalized = normalizeTaskList(list, "registration");

  expect(normalized.tasks.map((task) => task.id)).toEqual(["T1", "T2"]);
  expect(normalized.tasks[1]?.depends_on).toEqual(["T1"]);
});

test("waves mark independent tasks as parallel", () => {
  const list = readyTasks();
  const [, second] = requireTwoTasks(list);
  second.depends_on = [];

  const normalized = normalizeTaskList(list, "registration");

  expect(normalized.tasks.map((task) => task.wave)).toEqual([1, 1]);
  expect(normalized.tasks.every((task) => task.parallel)).toBe(true);
});

test("waves stay sequential when a task depends on another", () => {
  const normalized = normalizeTaskList(readyTasks(), "registration");

  expect(normalized.tasks.map((task) => task.wave)).toEqual([1, 2]);
  expect(normalized.tasks.some((task) => task.parallel)).toBe(false);
});

test("tasks are ordered by dependency wave", () => {
  const list = readyTasks();
  list.tasks.reverse();

  expect(orderTasks(list.tasks).map((task) => task.id)).toEqual(["T1", "T2"]);
});

test("task validation rejects dependency cycles", () => {
  const list = readyTasks();
  const [first, second] = requireTwoTasks(list);
  first.depends_on = ["T2"];
  second.depends_on = ["T1"];

  expect(() => validateTaskList(list, readySpec(), discovery())).toThrow(
    "Task dependency cycle includes T1",
  );
});

test("task validation rejects unapproved and unsafe paths", () => {
  const unapproved = readyTasks();
  const [unapprovedTask] = requireTwoTasks(unapproved);
  unapprovedTask.files.modify = ["src/unknown.ts"];
  expect(() => validateTaskList(unapproved, readySpec(), discovery())).toThrow(
    "T1 references unapproved file: src/unknown.ts",
  );

  const unsafe = readyTasks();
  const [unsafeTask] = requireTwoTasks(unsafe);
  unsafeTask.files.create = ["../secret.ts"];
  expect(() => validateTaskList(unsafe, readySpec(), discovery())).toThrow(
    "T1 contains unsafe path: ../secret.ts",
  );

  const disguisedExisting = readyTasks();
  const [, createTask] = requireTwoTasks(disguisedExisting);
  createTask.files.create = ["src/existing.ts"];
  expect(() =>
    validateTaskList(disguisedExisting, readySpec(), discovery(), [
      "src/auth.ts",
      "src/existing.ts",
    ]),
  ).toThrow("T2 lists existing file as create: src/existing.ts");

  const missingVerificationFile = readyTasks();
  const [verificationTask] = requireTwoTasks(missingVerificationFile);
  verificationTask.verification = [
    {
      command: { program: "bun", args: ["test", "src/missing.test.ts"] },
      purpose: "Run a missing test",
    },
  ];
  expect(() => validateTaskList(missingVerificationFile, readySpec(), discovery())).toThrow(
    "T1 verification references unavailable file: src/missing.test.ts",
  );
});

function requireTwoTasks(list: TaskList): [Task, Task] {
  const [first, second] = list.tasks;
  if (!first || !second) throw new Error("Test fixture must contain two tasks");
  return [first, second];
}
