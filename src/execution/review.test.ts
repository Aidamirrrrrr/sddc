import { expect, test } from "bun:test";
import { readySpec } from "../planning/test-fixtures";
import { readyTasks } from "../tasks/test-fixtures";
import { reviewProposal, validateExecutionReview } from "./review";
import type { ExecutionReview } from "./schemas";

test("execution review requires every quality check", () => {
  const review: ExecutionReview = {
    checks: Array.from({ length: 7 }, (_, index) => ({
      id: `E${index + 1}` as ExecutionReview["checks"][number]["id"],
      passed: true,
      finding: "Passed",
    })),
    findings: [],
  };
  expect(() => validateExecutionReview(review)).not.toThrow();
  review.checks[4] = { id: "E5", passed: false, finding: "Error is swallowed" };
  expect(() => validateExecutionReview(review)).toThrow("Execution review rejected proposal");
});

test("the reviewer is given what declares a decision, not only the specification", async () => {
  let captured: Record<string, unknown> = {};
  const plan = { summary: "Two steps", decisions: [{ statement: "Reuse the session store" }] };

  await reviewProposal(
    {
      async generateObject<T>(_instruction: string, prompt: string): Promise<T> {
        captured = JSON.parse(prompt);
        return {
          checks: Array.from({ length: 7 }, (_, index) => ({
            id: `E${index + 1}`,
            passed: true,
            finding: "Passed",
          })),
          findings: [],
        } as T;
      },
    },
    proposal(),
    {
      spec: readySpec(),
      task: task(),
      files: [],
      plan,
      constitution: "Every module owns its errors.",
      outputLanguage: "English",
      expectation: "Verification commands must pass once this task's changes are applied.",
      otherTasks: [{ id: "T2", status: "pending" }],
    },
  );

  // E7 asks whether an undeclared decision crept in; it cannot answer that without the plan and the
  // constitution that declare them.
  expect(captured.plan).toEqual(plan);
  expect(captured.constitution).toBe("Every module owns its errors.");
  expect(captured.expectation).toContain("must pass");
  expect(captured.otherTasks).toEqual([{ id: "T2", status: "pending" }]);
});

function proposal() {
  return {
    task_id: "T1",
    status: "ready" as const,
    summary: "Change auth",
    blocker: null,
    traceability: [{ covers: "R1", paths: ["src/auth.ts"] }],
    changes: [
      {
        path: "src/auth.ts",
        operation: "modify" as const,
        expected_sha256: "abc",
        content: "new\n",
      },
    ],
  };
}

function task() {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return first;
}

function review(overrides: Partial<ExecutionReview> = {}): ExecutionReview {
  return {
    checks: Array.from({ length: 7 }, (_, index) => ({
      id: `E${index + 1}` as ExecutionReview["checks"][number]["id"],
      passed: true,
      finding: "Passed",
    })),
    findings: [],
    ...overrides,
  };
}

test("a rejection names the check that refused, not only the prose", () => {
  const rejected = review();
  rejected.checks[0] = {
    id: "E1",
    passed: false,
    finding: "The acceptance criteria are asserted but not yet implemented",
  };
  // A live run failed with exactly this shape: the reviewer's own findings said the proposal was
  // correct, and nothing in the message named the check that disagreed.
  rejected.findings = [
    "The proposal correctly adds tests and is expected to fail. No issues found.",
  ];

  expect(() => validateExecutionReview(rejected)).toThrow(
    "failed checks: E1 (The acceptance criteria are asserted but not yet implemented)",
  );
});

test("a review that passes every check is a pass, whatever its notes say", () => {
  // A live run was refused by a review that had marked all seven passed and written "No issues
  // found" in its own findings, because a separate decision field said otherwise. The checks are
  // the verdict now, so there is nothing left to contradict them.
  const noted = review();
  noted.findings = ["No issues found. The change is correct and within scope."];

  expect(() => validateExecutionReview(noted)).not.toThrow();
});

test("a check the reviewer never returned is still named", () => {
  const partial = review();
  partial.checks = partial.checks.slice(0, 5);

  expect(() => validateExecutionReview(partial)).toThrow("failed checks: E6; E7");
});
