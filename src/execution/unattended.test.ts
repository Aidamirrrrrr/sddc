import { expect, test } from "bun:test";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { unattendedExecution } from "./ui";

function task(permissions: Task["permissions"] = []): Task {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return { ...first, permissions };
}

test("an unattended run accepts the diffs the accepted graph described", async () => {
  const { hooks } = unattendedExecution(defaultPolicy);

  const review = await hooks.review(
    task(),
    {
      task_id: "T1",
      status: "ready",
      summary: "Change auth",
      blocker: null,
      traceability: [],
      changes: [],
    },
    "",
  );

  expect(review.accepted).toBe(true);
});

test("a sensitive permission still blocks, because the promise was that it always would", async () => {
  const { hooks } = unattendedExecution(defaultPolicy);

  // A flag that quietly made "sensitive permissions are always confirmed" untrue would be worth
  // less than the automation it bought.
  expect(await hooks.approveSensitive?.(task(["dependencies"]))).toBe(false);
});

test("a failed task ends the run rather than looping without anyone watching", async () => {
  const { hooks } = unattendedExecution(defaultPolicy);

  expect(
    await hooks.retryAfterFailure(task(), {
      task_id: "T1",
      status: "failed",
      changed_files: [],
      verification: [],
      output_hashes: [],
      checkpoint: null,
    }),
  ).toBe(false);
});

test("strict is downgraded rather than silently honoured", () => {
  const strict = {
    ...defaultPolicy,
    execution: { ...defaultPolicy.execution, default_approval_mode: "strict" as const },
  };

  // Strict exists so a person authorizes each task. Unattended, nobody can, so the run says it is
  // running in a different mode instead of pretending the approvals happened.
  expect(unattendedExecution(strict).mode).toBe("normal");
  expect(unattendedExecution(defaultPolicy).mode).toBe("trusted");
});
