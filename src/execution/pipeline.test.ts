import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { readyTasks } from "../tasks/test-fixtures";
import { sha256 } from "./context";
import { buildTaskProposal } from "./pipeline";

test("invalid model proposal gets one constrained correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-proposal-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  const plan = readyPlan();
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const valid = {
    task_id: task.id,
    status: "ready" as const,
    summary: "Implement task",
    blocker: null,
    traceability: [
      { covers: "R1", paths: ["src/auth.ts"] },
      { covers: "A1", paths: ["src/auth.ts"] },
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
  ]);

  const result = await buildTaskProposal(client, root, readySpec(), plan, task);

  expect(result).toEqual(valid);
  // Two draws and no review: only the deterministic gate runs here, and it costs nothing to apply.
  expect(client.calls).toBe(2);
  expect(client.prompts[1]).toContain("may not modify outside.ts");
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
