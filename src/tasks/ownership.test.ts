import { expect, test } from "bun:test";
import { discovery, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { validateTaskPolicy } from "../policy/validate";
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
  // The rule lives beside test-first now, because under test-first this shape is the required one.
  const list = readyTasks();
  const [first, second] = list.tasks;
  if (!first || !second) throw new Error("Fixture must contain two tasks");
  first.acceptance = ["A1"];
  first.files = { read: ["src/auth.ts"], modify: [], create: ["src/auth.test.ts"], delete: [] };
  first.depends_on = [];
  second.acceptance = [];
  second.files = { read: ["src/auth.ts"], modify: ["src/auth.ts"], create: [], delete: [] };
  second.depends_on = [];

  expect(() => validateTaskPolicy(list.tasks, defaultPolicy)).toThrow(
    "T1 owns A1 but only writes tests and depends on nothing",
  );
});

test("under test-first that same shape is the prescribed one", () => {
  const list = readyTasks();
  const [first, second] = list.tasks;
  if (!first || !second) throw new Error("Fixture must contain two tasks");
  first.acceptance = ["A1"];
  first.files = { read: ["src/auth.ts"], modify: [], create: ["src/auth.test.ts"], delete: [] };
  first.depends_on = [];
  second.acceptance = [];
  second.files = { read: ["src/auth.ts"], modify: ["src/auth.ts"], create: [], delete: [] };
  second.depends_on = ["T1"];

  // Demanding a dependency here while test-first demands the opposite left no graph satisfiable.
  const testFirst = {
    ...defaultPolicy,
    changes: { ...defaultPolicy.changes, require_test_before_implementation: true },
  };
  expect(() => validateTaskPolicy(list.tasks, testFirst)).not.toThrow();
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
    first.files = { read: ["src/auth.ts"], modify: [], create: ["src/auth.test.ts"], delete: [] };
    first.depends_on = [];
    // Nothing in the graph writes behavioural source, so there is nothing to wait for.
    value.tasks = [first];
  });

  expect(() => validateTaskList(list, readySpec(), discovery())).not.toThrow();
});

/** A graph shaped like a real one: T1 changes the source, T2 updates the test that covers it. */
function sourceAndTestGraph(visibleToT1: string[]) {
  const list = readyTasks();
  const [first, second] = list.tasks;
  if (!first || !second) throw new Error("Fixture must contain two tasks");
  first.files = { read: visibleToT1, modify: ["src/auth.ts"], create: [], delete: [] };
  second.files = { read: ["src/auth.ts"], modify: ["src/auth.test.ts"], create: [], delete: [] };
  return list;
}

/** Discovery that approved the covering test, so a task is permitted to reference it. */
function discoveryWithTest() {
  const value = discovery();
  value.context.files = ["src/auth.ts", "src/auth.test.ts"];
  return value;
}

const repositoryWithTest = ["src/auth.ts", "src/auth.test.ts"];

test("a task changing source must bring the test that already covers it", () => {
  // T1 changes src/auth.ts but cannot see src/auth.test.ts, which exists and is approved.
  const list = sourceAndTestGraph(["src/auth.ts"]);

  expect(() =>
    validateTaskList(list, readySpec(), discoveryWithTest(), repositoryWithTest),
  ).toThrow("T1 changes src/auth.ts without src/auth.test.ts in scope");
});

test("reading the covering test is enough; the task need not modify it", () => {
  const list = sourceAndTestGraph(["src/auth.ts", "src/auth.test.ts"]);

  expect(() =>
    validateTaskList(list, readySpec(), discoveryWithTest(), repositoryWithTest),
  ).not.toThrow();
});

test("a test discovery never approved is not demanded, or no graph could satisfy both rules", () => {
  // Read paths must come from approved context, so a test outside it can never be brought in.
  const list = readyTasks();
  const [first] = list.tasks;
  if (!first) throw new Error("Fixture must contain a task");
  first.files = { read: ["src/auth.ts"], modify: ["src/auth.ts"], create: [], delete: [] };

  expect(() => validateTaskList(list, readySpec(), discovery(), ["src/auth.ts"])).not.toThrow();
});

test("a project without a sibling test is not constrained by guesswork", () => {
  const list = readyTasks();
  const [first] = list.tasks;
  if (!first) throw new Error("Fixture must contain a task");
  first.files = { read: ["src/auth.ts"], modify: ["src/auth.ts"], create: [], delete: [] };

  expect(() => validateTaskList(list, readySpec(), discovery(), ["src/auth.ts"])).not.toThrow();
});
