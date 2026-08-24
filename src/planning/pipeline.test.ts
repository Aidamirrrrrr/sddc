import { expect, test } from "bun:test";
import type { z } from "zod";
import { buildImplementationPlan } from "./pipeline";
import type { ImplementationPlan } from "./schemas";
import { discovery, readyPlan, readySpec } from "./test-fixtures";

test("planning pipeline builds and validates a reviewed plan", async () => {
  const plan = readyPlan();
  const [first, second] = plan.tasks;
  if (!first || !second) throw new Error("Test fixture must contain two tasks");
  first.id = "implementation";
  second.id = "tests";
  second.depends_on = ["implementation"];
  const responses = [plan, audit(), { plan, checks: passedChecks() }];
  const client = stub(responses);

  const result = await buildImplementationPlan(client, readySpec(), discovery());

  expect(result.tasks.map((task) => task.id)).toEqual(["T1", "T2"]);
  expect(result.tasks[1]?.depends_on).toEqual(["T1"]);
  expect(client.calls).toBe(3);
});

test("planning pipeline returns blocking questions without inventing a plan", async () => {
  const plan: ImplementationPlan = {
    status: "needs_clarification",
    feature: "registration",
    summary: "A storage decision is missing.",
    decisions: [],
    tasks: [],
    questions: [
      { id: "question", question: "Which store is used?", reason: "Not specified", blocking: true },
    ],
  };
  const responses = [
    plan,
    {
      ...audit(),
      decision: "needs_clarification",
      questions: [{ question: "Which store is used?", reason: "Not specified" }],
    },
    { plan, checks: [] },
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
  ];
  const client = stub(responses);

  const result = await buildImplementationPlan(client, readySpec(), discovery());

  expect(result.status).toBe("needs_clarification");
  expect(result.questions[0]?.id).toBe("Q1");
  expect(client.calls).toBe(4);
});

test("planning pipeline removes questions answered by repository context", async () => {
  const plan: ImplementationPlan = {
    ...readyPlan(),
    status: "needs_clarification",
    questions: [
      { id: "Q1", question: "Does the test file exist?", reason: "Uncertain", blocking: true },
    ],
  };
  const responses = [
    plan,
    audit(),
    { plan, checks: passedChecks() },
    {
      questions: [
        {
          question: "Does the test file exist?",
          reason: "Present in repository index",
          owner: "implementation",
          answerable_from_context: true,
          affects: [],
          user_visible_impact: false,
        },
      ],
    },
  ];

  const result = await buildImplementationPlan(stub(responses), readySpec(), discovery());

  expect(result.status).toBe("ready");
  expect(result.questions).toEqual([]);
});

test("planning pipeline repairs a plan rejected by project policy", async () => {
  const rejected = readyPlan();
  const first = rejected.tasks[0];
  if (!first) throw new Error("Test fixture must contain a task");
  first.files.create = ["package.json"];

  const repaired = structuredClone(rejected);
  const repairedFirst = repaired.tasks[0];
  if (!repairedFirst) throw new Error("Test fixture must contain a task");
  repairedFirst.permissions = ["dependencies"];

  const client = stub([rejected, audit(), { plan: rejected, checks: passedChecks() }, repaired]);
  const result = await buildImplementationPlan(client, readySpec(), discovery());

  expect(result.tasks[0]?.permissions).toEqual(["dependencies"]);
  expect(client.calls).toBe(4);
});

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
