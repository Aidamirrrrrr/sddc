import { expect, test } from "bun:test";
import type { z } from "zod";
import { buildImplementationPlan } from "./pipeline";
import type { ImplementationPlan } from "./schemas";
import { discovery, readyPlan, readySpec } from "./test-fixtures";

test("planning pipeline builds and validates a reviewed plan", async () => {
  const plan = readyPlan();
  plan.approach = [
    { id: "raw", statement: "Add the registration operation", requirements: ["R1"], touches: [] },
  ];
  const client = stub([plan, audit(), { plan, checks: passedChecks() }]);

  const result = await buildImplementationPlan(client, readySpec(), discovery());

  expect(result.approach.map((step) => step.id)).toEqual(["S1"]);
  expect(client.calls).toBe(3);
});

test("planning pipeline returns blocking questions without inventing a plan", async () => {
  const plan: ImplementationPlan = {
    status: "needs_clarification",
    feature: "registration",
    summary: "A storage decision is missing.",
    decisions: [],
    approach: [{ id: "S1", statement: "Blocked", requirements: ["R1"], touches: [] }],
    contracts: [],
    data_model: [],
    questions: [
      { id: "question", question: "Which store is used?", reason: "Not specified", blocking: true },
    ],
  };
  const client = stub([
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
  ]);

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
  const client = stub([
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
  ]);

  const result = await buildImplementationPlan(client, readySpec(), discovery());

  expect(result.status).toBe("ready");
  expect(result.questions).toEqual([]);
});

test("planning pipeline repairs a plan rejected by validation", async () => {
  const rejected = readyPlan();
  rejected.decisions = [
    { statement: "Reuse the store", rationale: "Exists", evidence: ["src/unknown.ts"] },
  ];
  const repaired = readyPlan();

  const client = stub([rejected, audit(), { plan: rejected, checks: passedChecks() }, repaired]);
  const result = await buildImplementationPlan(client, readySpec(), discovery());

  expect(result.decisions).toEqual([]);
  expect(client.calls).toBe(4);
});

test("a repair that is still wrong is drawn again rather than failing the phase", async () => {
  const rejected = readyPlan();
  rejected.decisions = [
    { statement: "Reuse the store", rationale: "Exists", evidence: ["src/unknown.ts"] },
  ];
  const stillWrong = readyPlan();
  stillWrong.decisions = [
    { statement: "Reuse the store", rationale: "Exists", evidence: ["src/other.ts"] },
  ];

  const client = stub([
    rejected,
    audit(),
    { plan: rejected, checks: passedChecks() },
    stillWrong,
    readyPlan(),
  ]);
  const result = await buildImplementationPlan(client, readySpec(), discovery());

  // The phase used to get exactly one repair and then end the run; it now spends its sampling budget.
  expect(result.decisions).toEqual([]);
  expect(client.calls).toBe(5);
});

test("planning still fails once the sampling budget is spent", async () => {
  const rejected = readyPlan();
  rejected.decisions = [
    { statement: "Reuse the store", rationale: "Exists", evidence: ["src/unknown.ts"] },
  ];

  const client = stub([
    rejected,
    audit(),
    { plan: rejected, checks: passedChecks() },
    readyPlan_with_bad_evidence(),
    readyPlan_with_bad_evidence(),
  ]);

  expect(buildImplementationPlan(client, readySpec(), discovery())).rejects.toThrow();
});

function readyPlan_with_bad_evidence(): ImplementationPlan {
  const plan = readyPlan();
  plan.decisions = [{ statement: "Reuse", rationale: "Exists", evidence: ["src/missing.ts"] }];
  return plan;
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
    requirement_coverage: [{ requirement: "R1", approach_ids: ["S1"] }],
    findings: [],
    questions: [],
  };
}

function passedChecks() {
  return Array.from({ length: 6 }, (_, index) => ({
    id: `C${index + 1}`,
    passed: true,
    finding: "Passed",
  }));
}
