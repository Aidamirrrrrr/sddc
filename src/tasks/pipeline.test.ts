import { expect, test } from "bun:test";
import type { z } from "zod";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { buildTaskList } from "./pipeline";
import type { TaskListDraft } from "./schemas";
import { readyTasks } from "./test-fixtures";

test("task pipeline builds, renumbers, and waves a reviewed graph", async () => {
  const tasks = draft();
  const [first, second] = tasks.tasks;
  if (!first || !second) throw new Error("Test fixture must contain two tasks");
  first.id = "implementation";
  second.id = "tests";
  second.depends_on = ["implementation"];
  const client = stub([tasks, audit(), { tasks, checks: passedChecks() }]);

  const result = await buildTaskList(client, readySpec(), readyPlan(), discovery());

  expect(result.tasks.map((task) => task.id)).toEqual(["T1", "T2"]);
  expect(result.tasks[1]?.depends_on).toEqual(["T1"]);
  expect(result.tasks.map((task) => task.wave)).toEqual([1, 2]);
  expect(client.calls).toBe(3);
});

test("task pipeline returns blocking questions without inventing tasks", async () => {
  const tasks: TaskListDraft = {
    status: "needs_clarification",
    feature: "registration",
    summary: "A storage decision is missing.",
    tasks: [],
    questions: [
      { id: "question", question: "Which store is used?", reason: "Not specified", blocking: true },
    ],
  };
  const client = stub([
    tasks,
    {
      ...audit(),
      decision: "needs_clarification",
      questions: [{ question: "Which store is used?", reason: "Not specified" }],
    },
    { tasks, checks: [] },
    {
      questions: [
        {
          question: "Which store is used?",
          reason: "Not specified",
          owner: "user",
          answerable_from_context: false,
          affects: ["R1"],
          user_visible_impact: true,
        },
      ],
    },
  ]);

  const result = await buildTaskList(client, readySpec(), readyPlan(), discovery());

  expect(result.status).toBe("needs_clarification");
  expect(result.questions[0]?.id).toBe("Q1");
  expect(client.calls).toBe(4);
});

test("task pipeline repairs a graph rejected by project policy", async () => {
  const rejected = draft();
  const first = rejected.tasks[0];
  if (!first) throw new Error("Test fixture must contain a task");
  first.files.create = ["package.json"];

  const repaired = structuredClone(rejected);
  const repairedFirst = repaired.tasks[0];
  if (!repairedFirst) throw new Error("Test fixture must contain a task");
  repairedFirst.permissions = ["dependencies"];

  const client = stub([rejected, audit(), { tasks: rejected, checks: passedChecks() }, repaired]);
  const result = await buildTaskList(client, readySpec(), readyPlan(), discovery());

  expect(result.tasks[0]?.permissions).toEqual(["dependencies"]);
  expect(client.calls).toBe(4);
});

function draft(): TaskListDraft {
  const list = readyTasks();
  return {
    ...list,
    tasks: list.tasks.map(({ wave: _wave, parallel: _parallel, ...task }) => task),
  };
}

function stub(responses: unknown[]) {
  return {
    calls: 0,
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      this.calls += 1;
      return responses.shift() as T;
    },
  };
}

function audit() {
  return {
    decision: "ready",
    requirement_coverage: [{ requirement: "R1", task_ids: ["T1"] }],
    acceptance_coverage: [{ acceptance: "A1", task_ids: ["T2"] }],
    findings: [],
    questions: [],
  };
}

function passedChecks() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `C${index + 1}`,
    passed: true,
    finding: "Passed",
  }));
}
