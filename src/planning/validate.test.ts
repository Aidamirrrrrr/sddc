import { expect, test } from "bun:test";
import { discovery, readyPlan, readySpec } from "./test-fixtures";
import { normalizePlan, validatePlan } from "./validate";

test("plan normalization renumbers approach steps", () => {
  const plan = readyPlan();
  plan.approach = [
    { id: "first", statement: "Add the operation", requirements: ["R1", "R1"], touches: [] },
    { id: "second", statement: "Cover it with tests", requirements: ["R1"], touches: [] },
  ];

  const normalized = normalizePlan(plan, "registration");

  expect(normalized.approach.map((step) => step.id)).toEqual(["S1", "S2"]);
  expect(normalized.approach[0]?.requirements).toEqual(["R1"]);
});

test("plan validation rejects evidence outside the approved context", () => {
  const plan = readyPlan();
  plan.decisions = [
    { statement: "Reuse the store", rationale: "Exists", evidence: ["src/unknown.ts"] },
  ];

  expect(() => validatePlan(plan, readySpec(), discovery())).toThrow(
    "Plan decision references unapproved evidence: src/unknown.ts",
  );
});

test("plan validation rejects an approach that leaves a requirement uncovered", () => {
  const plan = readyPlan();
  plan.approach = [{ id: "S1", statement: "Do something else", requirements: [], touches: [] }];

  expect(() => validatePlan(plan, readySpec(), discovery())).toThrow(
    "Plan approach does not cover requirements: R1",
  );
});

test("plan validation rejects unknown requirement references", () => {
  const plan = readyPlan();
  plan.approach = [{ id: "S1", statement: "Do the work", requirements: ["R9"], touches: [] }];

  expect(() => validatePlan(plan, readySpec(), discovery())).toThrow(
    "S1 references unknown requirement: R9",
  );
});
