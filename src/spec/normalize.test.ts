import { describe, expect, test } from "bun:test";
import { normalizeSpec } from "./normalize";
import type { Spec } from "./schemas";

function readySpec(): Spec {
  return {
    status: "ready",
    feature: "registration",
    goal: "Register users",
    requirements: [{ id: "raw", statement: "Works" }],
    acceptance: [{ id: "raw-test", verifies: ["raw"], statement: "Can be verified" }],
    issues: [],
    questions: [],
    subfeatures: [],
  };
}

describe("normalizeSpec", () => {
  test("renumbers requirements and references", () => {
    const spec = normalizeSpec(readySpec());
    expect(spec.requirements[0]?.id).toBe("R1");
    expect(spec.acceptance[0]?.id).toBe("A1");
    expect(spec.acceptance[0]?.verifies).toEqual(["R1"]);
  });

  test("limits clarification questions", () => {
    const input = readySpec();
    input.questions = Array.from({ length: 5 }, (_, index) => ({
      id: "",
      question: `Question ${index}`,
      reason: "Changes behavior",
      blocking: false,
    }));
    const spec = normalizeSpec(input);
    expect(spec.status).toBe("needs_clarification");
    expect(spec.questions).toHaveLength(3);
    expect(spec.questions.every((item) => item.blocking)).toBe(true);
  });

  test("recognizes decomposition", () => {
    const input = readySpec();
    input.subfeatures = [
      { id: "one", feature: "one", goal: "One", fact_ids: ["F1"], depends_on: [] },
      { id: "two", feature: "two", goal: "Two", fact_ids: ["F2"], depends_on: ["one"] },
    ];
    const spec = normalizeSpec(input);
    expect(spec.status).toBe("needs_decomposition");
    expect(spec.subfeatures).toHaveLength(2);
    expect(spec.subfeatures[1]?.depends_on).toEqual(["F1"]);
  });
});
