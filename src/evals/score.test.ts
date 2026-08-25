import { expect, test } from "bun:test";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import type { EvalCase } from "./corpus";
import { formatScore, scoreCase, summarize } from "./score";

function evalCase(): EvalCase {
  return {
    name: "registration",
    spec: readySpec(),
    discovery: discovery(),
    policy: defaultPolicy,
    plan: readyPlan(),
    tasks: readyTasks(),
  };
}

test("an accepted run scores clean", () => {
  const score = scoreCase(evalCase());

  expect(score.passed).toBe(true);
  expect(score.findings).toBe(0);
  expect(score.checks.map((check) => check.id)).toEqual([
    "spec-valid",
    "plan-valid",
    "tasks-valid",
    "tasks-policy",
  ]);
});

test("a candidate that leaves a requirement uncovered fails the case", () => {
  const item = evalCase();
  const tasks = readyTasks();
  // What a weaker model actually does: fewer tasks, and a requirement falls through.
  const first = tasks.tasks[0];
  if (!first) throw new Error("Fixture must contain a task");
  first.requirements = [];
  tasks.tasks = [first];

  const score = scoreCase(item, { tasks });

  expect(score.passed).toBe(false);
  expect(score.checks.find((check) => check.id === "tasks-valid")?.detail).toContain("R1");
});

test("policy limits are part of the score", () => {
  const item = { ...evalCase(), policy: { ...defaultPolicy } };
  item.policy.changes = { ...defaultPolicy.changes, max_files_per_task: 0 };

  const score = scoreCase(item);

  expect(score.checks.find((check) => check.id === "tasks-policy")?.passed).toBe(false);
});

test("coverage gaps are counted without failing the case", () => {
  const item = evalCase();
  item.spec.acceptance.push({ id: "A2", verifies: ["R1"], statement: "Duplicates are rejected" });

  const score = scoreCase(item);

  // The acceptance criterion no task verifies is a finding; the validators still pass.
  expect(score.findings).toBeGreaterThan(0);
});

test("the summary rolls cases up and reads as a report", () => {
  const clean = scoreCase(evalCase());
  const broken = scoreCase({ ...evalCase(), name: "broken" }, { tasks: emptyTasks() });

  const score = summarize([clean, broken]);

  expect(score).toMatchObject({ passed: 1, total: 2 });
  expect(formatScore(score)).toContain("1/2 cases pass");
  expect(formatScore(score)).toContain("✗  broken");
});

function emptyTasks() {
  const tasks = readyTasks();
  tasks.tasks = [];
  return tasks;
}
