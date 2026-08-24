import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { sha256 } from "./context";
import { buildTaskProposal, orderTasks } from "./pipeline";
import type { ExecutionReview } from "./schemas";

test("invalid model proposal gets one constrained correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "spec-agent-proposal-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  const plan = readyPlan();
  const task = plan.tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const valid = {
    task_id: task.id,
    status: "ready" as const,
    summary: "Implement task",
    blocker: null,
    traceability: [
      { requirement_id: "R1", paths: ["src/auth.ts"] },
      { requirement_id: "A1", paths: ["src/auth.ts"] },
    ],
    changes: [
      {
        path: "src/auth.ts",
        operation: "modify" as const,
        expected_sha256: sha256("old\n"),
        content: "new\n",
      },
    ],
  };
  const client = stub([
    { ...valid, changes: [{ ...valid.changes[0], path: "outside.ts" }] },
    valid,
    passedReview(),
  ]);

  const result = await buildTaskProposal(client, root, readySpec(), plan, task);

  expect(result).toEqual(valid);
  expect(client.calls).toBe(3);
  expect(client.prompts[1]).toContain("may not modify outside.ts");
});

test("tasks are ordered by dependencies", () => {
  const plan = readyPlan();
  plan.tasks.reverse();
  expect(orderTasks(plan).map((task) => task.id)).toEqual(["T1", "T2"]);
});

test("review rejection gets one implementation revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "spec-agent-review-repair-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  const plan = readyPlan();
  const task = plan.tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const proposal = {
    task_id: task.id,
    status: "ready" as const,
    summary: "Implement task",
    blocker: null,
    traceability: [
      { requirement_id: "R1", paths: ["src/auth.ts"] },
      { requirement_id: "A1", paths: ["src/auth.ts"] },
    ],
    changes: [
      {
        path: "src/auth.ts",
        operation: "modify" as const,
        expected_sha256: sha256("old\n"),
        content: "new\n",
      },
    ],
  };
  const rejected = passedReview();
  rejected.decision = "reject";
  rejected.checks[4] = { id: "E5", passed: false, finding: "Error is swallowed" };
  rejected.findings = ["Do not swallow the error"];
  const client = stub([proposal, rejected, proposal, passedReview()]);

  const result = await buildTaskProposal(client, root, readySpec(), plan, task);

  expect(result).toEqual(proposal);
  expect(client.calls).toBe(4);
  expect(client.prompts[2]).toContain("Do not swallow the error");
});

function stub(responses: unknown[]) {
  return {
    calls: 0,
    prompts: [] as string[],
    async generateObject<T>(_system: string, prompt: string, _schema: z.ZodType<T>): Promise<T> {
      this.calls += 1;
      this.prompts.push(prompt);
      return responses.shift() as T;
    },
  };
}

function passedReview(): ExecutionReview {
  return {
    decision: "pass",
    checks: Array.from({ length: 7 }, (_, index) => ({
      id: `E${index + 1}` as ExecutionReview["checks"][number]["id"],
      passed: true,
      finding: "Passed",
    })),
    findings: [],
  };
}
