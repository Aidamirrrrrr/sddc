import { expect, test } from "bun:test";
import type { Task } from "../tasks/schemas";
import { assignWaves } from "../tasks/validate";
import { defaultPolicy } from "./load";
import { isBehaviouralSource, isTestPath } from "./paths";
import { validateTaskPolicy } from "./validate";

const testFirst = {
  ...defaultPolicy,
  changes: { ...defaultPolicy.changes, require_test_before_implementation: true },
};

function task(id: string, dependsOn: string[], writes: string[]): Task {
  return {
    id,
    title: id,
    goal: id,
    requirements: ["R1"],
    acceptance: ["A1"],
    depends_on: dependsOn,
    permissions: [],
    files: { read: [], modify: [], create: writes },
    verification: [{ command: { program: "bun", args: ["test"] }, purpose: "check" }],
    done_when: ["done"],
    risks: [],
    wave: 1,
    parallel: false,
  };
}

test("implementation that depends on a test task is accepted", () => {
  const tasks = assignWaves([
    task("T1", [], ["src/auth.test.ts"]),
    task("T2", ["T1"], ["src/auth.ts"]),
  ]);

  expect(() => validateTaskPolicy(tasks, testFirst)).not.toThrow();
});

test("implementation with no test behind it is rejected", () => {
  const tasks = assignWaves([task("T1", [], ["src/auth.ts"])]);

  expect(() => validateTaskPolicy(tasks, testFirst)).toThrow(
    "T1 changes src/auth.ts without depending on a task that writes a test",
  );
});

test("a test written in the same task does not count as test-first", () => {
  const tasks = assignWaves([task("T1", [], ["src/auth.ts", "src/auth.test.ts"])]);

  // Otherwise "first" would mean nothing: the ordering is the whole point of the rule.
  expect(() => validateTaskPolicy(tasks, testFirst)).toThrow("without depending on a task");
});

test("a transitive dependency on a test task satisfies the rule", () => {
  const tasks = assignWaves([
    task("T1", [], ["src/auth.test.ts"]),
    task("T2", ["T1"], ["src/session.ts"]),
    task("T3", ["T2"], ["src/auth.ts"]),
  ]);

  expect(() => validateTaskPolicy(tasks, testFirst)).not.toThrow();
});

test("configuration and documentation changes need no test behind them", () => {
  // tsconfig is left out on purpose: it trips the separate configuration-permission rule.
  const tasks = assignWaves([task("T1", [], ["README.md", "deploy/values.yaml"])]);

  expect(() => validateTaskPolicy(tasks, testFirst)).not.toThrow();
});

test("the rule is off unless the project turns it on", () => {
  const tasks = assignWaves([task("T1", [], ["src/auth.ts"])]);

  expect(() => validateTaskPolicy(tasks, defaultPolicy)).not.toThrow();
});

test("test paths are recognised across common layouts", () => {
  for (const path of [
    "src/auth.test.ts",
    "src/auth.spec.js",
    "tests/auth.py",
    "src/__tests__/auth.ts",
    "spec/models/user_spec.rb",
    "src/auth_test.go",
  ]) {
    expect(isTestPath(path)).toBe(true);
    expect(isBehaviouralSource(path)).toBe(false);
  }
  expect(isBehaviouralSource("src/auth.ts")).toBe(true);
  expect(isBehaviouralSource("package.json")).toBe(false);
});

const coverage = {
  acceptance: [
    { id: "A1", verifies: ["R1"], statement: "Signing in succeeds" },
    { id: "A9", verifies: ["R9"], statement: "Something unrelated" },
  ],
};

function serving(id: string, dependsOn: string[], writes: string[], requirements: string[]): Task {
  return { ...task(id, dependsOn, writes), requirements, acceptance: [] };
}

test("a test task counts only when it covers the work depending on it", () => {
  // T1 writes a test for a different requirement entirely; T2 leaning on it is not test-first.
  const tasks = assignWaves([
    serving("T1", [], ["src/billing.test.ts"], ["R9"]),
    serving("T2", ["T1"], ["src/auth.ts"], ["R1"]),
  ]);

  expect(() => validateTaskPolicy(tasks, testFirst, coverage)).toThrow(
    "no test it depends on (T1) covers R1",
  );
});

test("sharing the requirement is enough to make the test count", () => {
  const tasks = assignWaves([
    serving("T1", [], ["src/auth.test.ts"], ["R1"]),
    serving("T2", ["T1"], ["src/auth.ts"], ["R1"]),
  ]);

  expect(() => validateTaskPolicy(tasks, testFirst, coverage)).not.toThrow();
});

test("owning a criterion that verifies the requirement also counts", () => {
  const [first, second] = assignWaves([
    serving("T1", [], ["src/auth.test.ts"], ["R2"]),
    serving("T2", ["T1"], ["src/auth.ts"], ["R1"]),
  ]);
  if (!first || !second) throw new Error("Expected two tasks");
  // T1 serves a different requirement, but the criterion it owns is what proves R1.
  first.acceptance = ["A1"];

  expect(() => validateTaskPolicy([first, second], testFirst, coverage)).not.toThrow();
});

test("without spec coverage the rule falls back to shared requirements", () => {
  const tasks = assignWaves([
    serving("T1", [], ["src/auth.test.ts"], ["R1"]),
    serving("T2", ["T1"], ["src/auth.ts"], ["R1"]),
  ]);

  expect(() => validateTaskPolicy(tasks, testFirst)).not.toThrow();
});
