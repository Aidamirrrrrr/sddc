import { expect, test } from "bun:test";
import { readyTasks } from "../tasks/test-fixtures";
import { defaultPolicy } from "./load";
import { validateTaskPolicy } from "./validate";

test("default policy accepts a focused task graph", () => {
  expect(() => validateTaskPolicy(readyTasks().tasks, defaultPolicy)).not.toThrow();
});

test("policy requires explicit permission for dependency files", () => {
  const tasks = readyTasks().tasks;
  const task = firstTask(tasks);
  task.files.modify.push("package.json");

  expect(() => validateTaskPolicy(tasks, defaultPolicy)).toThrow(
    "T1 changes dependency file without permission: package.json",
  );

  task.permissions.push("dependencies");
  expect(() => validateTaskPolicy(tasks, defaultPolicy)).not.toThrow();
});

test("policy detects network commands and unordered writes", () => {
  const network = readyTasks().tasks;
  firstTask(network).verification.push({
    command: { program: "bun", args: ["add", "zod"] },
    purpose: "Install dependency",
  });
  expect(() => validateTaskPolicy(network, defaultPolicy)).toThrow(
    "T1 uses external network forbidden by policy",
  );

  const unordered = readyTasks().tasks;
  const [first, second] = requireTwoTasks(unordered);
  second.depends_on = [];
  second.files.modify = [...first.files.modify];
  expect(() => validateTaskPolicy(unordered, defaultPolicy)).toThrow(
    "T1 and T2 both change src/auth.ts without ordering",
  );
});

function firstTask(tasks: ReturnType<typeof readyTasks>["tasks"]) {
  const task = tasks[0];
  if (!task) throw new Error("Test fixture must contain a task");
  return task;
}

function requireTwoTasks(tasks: ReturnType<typeof readyTasks>["tasks"]) {
  const [first, second] = tasks;
  if (!first || !second) throw new Error("Test fixture must contain two tasks");
  return [first, second] as const;
}

test("a shared file is ordered whichever way the dependency points", () => {
  // Waves come from the graph, not from the position a task happens to occupy in the array, so
  // requiring the later-indexed task to be the dependent one rejected valid graphs.
  const tasks = readyTasks().tasks;
  const [first, second] = requireTwoTasks(tasks);
  second.depends_on = [];
  second.files.modify = [...first.files.modify];
  first.depends_on = [second.id];

  expect(() => validateTaskPolicy(tasks, defaultPolicy)).not.toThrow();
});

test("a transitive dependency orders a shared file just as well", () => {
  const tasks = readyTasks().tasks;
  const [first, second] = requireTwoTasks(tasks);
  const middle = {
    ...second,
    id: "T3",
    depends_on: [second.id],
    files: { read: [], modify: [], create: ["src/middle.ts"] },
  };
  second.depends_on = [];
  second.files.modify = [...first.files.modify];
  first.depends_on = [middle.id];

  expect(() => validateTaskPolicy([first, second, middle], defaultPolicy)).not.toThrow();
});
