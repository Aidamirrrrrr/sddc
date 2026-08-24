import { afterEach, expect, test } from "bun:test";
import { specSchema } from "../spec/schemas";
import { specSummary } from "./presentation";
import { setUiLanguage } from "./ui";

afterEach(() => setUiLanguage("English"));

test("specification summary stays compact and follows the UI language", () => {
  const spec = specSchema.parse({
    status: "ready",
    feature: "cookie-service",
    goal: "Extract cookie methods",
    requirements: Array.from({ length: 8 }, (_, index) => ({
      id: `R${index + 1}`,
      statement: `Requirement ${index + 1}`,
    })),
    acceptance: [{ id: "A1", verifies: ["R1"], statement: "Service exists" }],
    issues: [],
    questions: [],
    subfeatures: [],
  });

  setUiLanguage("ru");
  const summary = specSummary(spec);

  expect(summary).toContain("8 требований · 1 проверок приёмки");
  expect(summary).toContain("R6  Requirement 6");
  expect(summary).not.toContain("R7  Requirement 7");
  expect(summary).toContain("Остальное в полном документе");
});
