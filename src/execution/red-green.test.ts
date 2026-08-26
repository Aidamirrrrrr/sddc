import { expect, test } from "bun:test";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { failureFeedback, verificationSatisfied } from "./task-executor";

const testFirst = {
  ...defaultPolicy,
  changes: { ...defaultPolicy.changes, require_test_before_implementation: true },
};

function taskWriting(modify: string[], create: string[] = []): Task {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  return { ...task, files: { read: [], modify, create, delete: [] } };
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

const crashed = [
  { program: "bun", args: ["test"], exit_code: 127, timed_out: false, output: "command not found" },
];
const timedOut = [{ program: "bun", args: ["test"], exit_code: 143, timed_out: true, output: "" }];
const killed = [
  { program: "bun", args: ["test"], exit_code: 139, timed_out: false, output: "segfault" },
];

test("a suite that could not run is not a correctly failing test", () => {
  const task = taskWriting([], ["src/auth.test.ts"]);

  // Accepting any non-zero exit made the inverted expectation trivially satisfiable: a typo in the
  // test file counted as red-green discipline.
  expect(verificationSatisfied(task, testFirst, crashed)).toBe(false);
  expect(verificationSatisfied(task, testFirst, timedOut)).toBe(false);
  expect(verificationSatisfied(task, testFirst, killed)).toBe(false);
});

test("an inverted expectation with nothing to judge is not satisfied", () => {
  const task = taskWriting([], ["src/auth.test.ts"]);

  expect(verificationSatisfied(task, testFirst, [])).toBe(false);
  // And the ordinary direction agrees: no command run is no evidence of success.
  expect(verificationSatisfied(taskWriting(["src/auth.ts"]), defaultPolicy, [])).toBe(false);
});

test("a red run is judged by the command that actually failed", () => {
  const task = taskWriting([], ["src/auth.test.ts"]);
  const passedThenFailed = [...green, ...red];

  expect(verificationSatisfied(task, testFirst, passedThenFailed)).toBe(true);
});

/**
 * What the task is told when it failed decides what it corrects next, and under test-first two very
 * different failures wear the same status: a test that passed too early, and a suite that never ran.
 * Telling them apart in prose is the whole job of this function — get it wrong and the next draw
 * fixes the wrong thing.
 */
function failure(verification: typeof green): Parameters<typeof failureFeedback>[2] {
  return {
    task_id: "T1",
    status: "failed",
    changed_files: ["src/auth.test.ts"],
    verification,
    output_hashes: [],
    checkpoint: null,
  };
}

test("a test that passed too early is told it asserts nothing", () => {
  const task = taskWriting([], ["src/auth.test.ts"]);

  const message = failureFeedback(task, testFirst, failure(green));

  expect(message).toContain("passed before its implementation exists");
  expect(message).toContain("R1");
});

test("a suite that never started is told so instead", () => {
  const task = taskWriting([], ["src/auth.test.ts"]);

  // 127 and a timeout both mean nothing was asserted either way. Reusing the "passed too early"
  // message here would send the model off weakening an assertion that never ran.
  expect(failureFeedback(task, testFirst, failure(crashed))).toContain("could not be run");
  expect(failureFeedback(task, testFirst, failure(timedOut))).toContain("could not be run");
});

test("an ordinary task is told its changes were rolled back", () => {
  const task = taskWriting(["src/auth.ts"]);

  const message = failureFeedback(task, defaultPolicy, failure(red));

  expect(message).toContain("rolled back");
  expect(message).toContain("bun test");
});
