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
