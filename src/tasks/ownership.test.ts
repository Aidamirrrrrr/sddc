import { expect, test } from "bun:test";
import { discovery, readySpec } from "../planning/test-fixtures";
import { readyTasks } from "./test-fixtures";
import { validateTaskList } from "./validate";

function tasksWith(change: (list: ReturnType<typeof readyTasks>) => void) {
  const list = readyTasks();
  change(list);
  return list;
}

test("a criterion claimed by two tasks is rejected", () => {
  const list = tasksWith((value) => {
    const [first] = value.tasks;
    if (!first) throw new Error("Fixture must contain a task");
    first.acceptance = ["A1"];
  });

  expect(() => validateTaskList(list, readySpec(), discovery())).toThrow(
    "Acceptance criteria must be owned by exactly one task: A1 by T1, T2",
  );
});

test("a task serving only a requirement is legitimate", () => {
  // T1 carries no acceptance at all; the criterion lives with the test that verifies it.
  expect(() => validateTaskList(readyTasks(), readySpec(), discovery())).not.toThrow();
});

test("a criterion nobody owns is still a coverage failure", () => {
  const list = tasksWith((value) => {
    for (const task of value.tasks) task.acceptance = [];
  });

  expect(() => validateTaskList(list, readySpec(), discovery())).toThrow(
    "Task list does not cover acceptance criteria: A1",
  );
});

test("exclusivity is not demanded of a graph that is still asking questions", () => {
  const list = tasksWith((value) => {
    value.status = "needs_clarification";
    value.questions = [{ id: "Q1", question: "Which?", reason: "Unclear", blocking: true }];
    const [first] = value.tasks;
    if (!first) throw new Error("Fixture must contain a task");
    first.acceptance = ["A1"];
  });

  // An unfinished graph is allowed to be inconsistent; only a ready one must partition.
  expect(() => validateTaskList(list, readySpec(), discovery())).not.toThrow();
});

test("a criterion owner that only writes tests and waits for nobody is rejected", () => {
  // The exact graph the live run produced: T1 owns everything, writes only the test, depends on
  // nothing, so it would run before src/store.ts had the function under test.
  const list = tasksWith((value) => {
    const [first, second] = value.tasks;
    if (!first || !second) throw new Error("Fixture must contain two tasks");
    first.acceptance = ["A1"];
    first.files = { read: ["src/auth.ts"], modify: [], create: ["src/auth.test.ts"] };
    first.depends_on = [];
    second.acceptance = [];
    second.files = { read: ["src/auth.ts"], modify: ["src/auth.ts"], create: [] };
    second.depends_on = [];
  });

  expect(() => validateTaskList(list, readySpec(), discovery())).toThrow(
    "T1 owns A1 but only writes tests and depends on nothing",
  );
});

test("a test-only owner that waits for the implementation is fine", () => {
  // This is the fixture's own shape: T2 tests, and depends on T1 which writes the source.
  expect(() => validateTaskList(readyTasks(), readySpec(), discovery())).not.toThrow();
});

test("adding a test for behaviour that already exists needs no dependency", () => {
  const list = tasksWith((value) => {
    const [first] = value.tasks;
    if (!first) throw new Error("Fixture must contain a task");
    first.acceptance = ["A1"];
    first.files = { read: ["src/auth.ts"], modify: [], create: ["src/auth.test.ts"] };
    first.depends_on = [];
    // Nothing in the graph writes behavioural source, so there is nothing to wait for.
    value.tasks = [first];
  });

  expect(() => validateTaskList(list, readySpec(), discovery())).not.toThrow();
});
