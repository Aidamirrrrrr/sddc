import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { assertTasksFitOutputBudget } from "./validate";

/**
 * Two limits described the same thing and disagreed: policy allowed a generated file of 128 KiB,
 * roughly 35,000 tokens of source, while the default completion cap is 32,768 — shared with the
 * model's reasoning. The policy promised a size the transport could not deliver, and said so only
 * by returning nothing, halfway through a run.
 */
function taskModifying(paths: string[]): Task {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return { ...first, files: { read: [], modify: paths, create: [], delete: [] } };
}

async function workspace(bytes: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-budget-"));
  await Bun.write(join(root, "src/auth.ts"), "x".repeat(bytes));
  return root;
}

test("a file that cannot be written back in one completion is refused before the run", async () => {
  const root = await workspace(200_000);

  await expect(
    assertTasksFitOutputBudget(root, [taskModifying(["src/auth.ts"])], 32_768),
  ).rejects.toThrow("cannot be written back in one piece");
});

test("a file that comfortably fits says nothing", async () => {
  const root = await workspace(4_000);

  await expect(
    assertTasksFitOutputBudget(root, [taskModifying(["src/auth.ts"])], 32_768),
  ).resolves.toBeUndefined();
});

test("an uncapped completion has no budget to exceed", async () => {
  const root = await workspace(2_000_000);

  // AI_MAX_OUTPUT_TOKENS=off leaves the model's own maximum in force, which this cannot reason about.
  await expect(
    assertTasksFitOutputBudget(root, [taskModifying(["src/auth.ts"])], undefined),
  ).resolves.toBeUndefined();
});

test("a file the task creates has no size yet and is not guessed at", async () => {
  const root = await workspace(1_000);
  const creating = {
    ...taskModifying([]),
    files: { read: [], modify: [], create: ["src/new.ts"], delete: [] },
  };

  await expect(assertTasksFitOutputBudget(root, [creating], 32_768)).resolves.toBeUndefined();
});
