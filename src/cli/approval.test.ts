import { describe, expect, test } from "bun:test";
import type { Spec } from "../spec/schemas";
import { formatSpec, parseReviewDecision } from "./approval";

describe("spec approval", () => {
  test("recognizes explicit acceptance and revision", () => {
    expect(parseReviewDecision("accept")).toBe("accept");
    expect(parseReviewDecision("Y")).toBe("accept");
    expect(parseReviewDecision("revise")).toBe("revise");
    expect(parseReviewDecision("no")).toBe("revise");
    expect(parseReviewDecision("maybe")).toBeNull();
  });

  test("formats a specification as YAML", () => {
    const spec: Spec = {
      status: "ready",
      feature: "example",
      goal: "Example goal",
      requirements: [],
      acceptance: [],
      issues: [],
      questions: [],
      subfeatures: [],
    };

    expect(formatSpec(spec)).toContain("status: ready");
    expect(formatSpec(spec)).toContain("feature: example");
  });
});
