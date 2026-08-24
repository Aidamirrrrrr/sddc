import { expect, test } from "bun:test";
import { readyPlan } from "../planning/test-fixtures";
import { defaultPolicy } from "./load";
import { validatePlanPolicy } from "./validate";

test("default policy accepts a focused plan", () => {
  expect(() => validatePlanPolicy(readyPlan(), defaultPolicy)).not.toThrow();
});

test("policy requires explicit permission for dependency files", () => {
  const plan = readyPlan();
  const task = firstTask(plan);
  task.files.modify.push("package.json");

  expect(() => validatePlanPolicy(plan, defaultPolicy)).toThrow(
    "T1 changes dependency file without permission: package.json",
  );

  task.permissions.push("dependencies");
  expect(() => validatePlanPolicy(plan, defaultPolicy)).not.toThrow();
});

test("policy detects network commands and unordered writes", () => {
  const networkPlan = readyPlan();
  firstTask(networkPlan).verification.push({
    command: { program: "bun", args: ["add", "zod"] },
    purpose: "Install dependency",
  });
  expect(() => validatePlanPolicy(networkPlan, defaultPolicy)).toThrow(
    "T1 uses external network forbidden by policy",
  );

  const unorderedPlan = readyPlan();
  const [first, second] = requireTwoTasks(unorderedPlan);
  second.depends_on = [];
  second.files.modify = [...first.files.modify];
  expect(() => validatePlanPolicy(unorderedPlan, defaultPolicy)).toThrow(
    "T1 and T2 both change src/auth.ts without ordering",
  );
});

function firstTask(plan: ReturnType<typeof readyPlan>) {
  const task = plan.tasks[0];
  if (!task) throw new Error("Test fixture must contain a task");
  return task;
}

function requireTwoTasks(plan: ReturnType<typeof readyPlan>) {
  const [first, second] = plan.tasks;
  if (!first || !second) throw new Error("Test fixture must contain two tasks");
  return [first, second] as const;
}
