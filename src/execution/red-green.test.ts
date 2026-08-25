import { expect, test } from "bun:test";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { verificationSatisfied } from "./task-executor";

const testFirst = {
  ...defaultPolicy,
  changes: { ...defaultPolicy.changes, require_test_before_implementation: true },
};

function taskWriting(modify: string[], create: string[] = []): Task {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  return { ...task, files: { read: [], modify, create } };
}

const green = [{ program: "bun", args: ["test"], exit_code: 0, timed_out: false, output: "" }];
const red = [{ program: "bun", args: ["test"], exit_code: 1, timed_out: false, output: "1 fail" }];

test("an ordinary task passes when its verification is green", () => {
  const task = taskWriting(["src/auth.ts"]);

  expect(verificationSatisfied(task, defaultPolicy, green)).toBe(true);
  expect(verificationSatisfied(task, defaultPolicy, red)).toBe(false);
});

test("under test-first a test-only task must leave the suite red", () => {
  const task = taskWriting([], ["src/auth.test.ts"]);

  // A test that passes before its implementation exists asserts nothing.
  expect(verificationSatisfied(task, testFirst, green)).toBe(false);
  expect(verificationSatisfied(task, testFirst, red)).toBe(true);
});

test("a task that writes a test alongside real source is judged normally", () => {
  const task = taskWriting(["src/auth.ts"], ["src/auth.test.ts"]);

  // Not test-only, so the implementation it carries is expected to make the suite green.
  expect(verificationSatisfied(task, testFirst, green)).toBe(true);
  expect(verificationSatisfied(task, testFirst, red)).toBe(false);
});

test("the inverted expectation applies only when the rule is on", () => {
  const task = taskWriting([], ["src/auth.test.ts"]);

  expect(verificationSatisfied(task, defaultPolicy, green)).toBe(true);
});

test("the expectation is derived from the files, so a task cannot declare its way out", () => {
  // Same task, same policy; only what it writes decides how its verification is judged.
  const tests = taskWriting([], ["src/auth.test.ts"]);
  const source = taskWriting(["src/auth.ts"]);

  expect(verificationSatisfied(tests, testFirst, green)).toBe(false);
  expect(verificationSatisfied(source, testFirst, green)).toBe(true);
});
