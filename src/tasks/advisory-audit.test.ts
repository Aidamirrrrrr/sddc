import { expect, test } from "bun:test";
import { discovery, readyPlan, readySpec } from "../planning/test-fixtures";
import { buildTaskList } from "./pipeline";
import { taskPrompts } from "./prompts";
import { readyTasks } from "./test-fixtures";

function passedChecks() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `C${index + 1}`,
    passed: true,
    finding: "Passed",
  }));
}

/** Fails the audit the way a spent output budget does, and answers everything else. */
function clientWithoutAudit(seen: string[]) {
  return {
    async generateObject<T>(instruction: string, prompt: string): Promise<T> {
      if (instruction === taskPrompts.audit) throw new Error("No output generated.");
      if (instruction === taskPrompts.draft) return readyTasks() as T;
      seen.push(prompt);
      return { tasks: readyTasks(), checks: passedChecks() } as T;
    },
  };
}

test("a task graph is still produced when the audit returns nothing", async () => {
  const seen: string[] = [];

  const tasks = await buildTaskList(
    clientWithoutAudit(seen),
    readySpec(),
    readyPlan(),
    discovery(),
  );

  // The audit only advises; coverage, cycles and ordering are recomputed by the validators anyway.
  expect(tasks.status).toBe("ready");
  expect(tasks.tasks).not.toHaveLength(0);
  // And the review is given a context without an audit key at all, so the cached prefix is intact.
  expect(seen[0]).not.toContain('"audit"');
});
