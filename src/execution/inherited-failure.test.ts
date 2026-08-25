import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { executionPrompts } from "./prompts";
import { executePlan } from "./runner";

const testFirst = {
  ...defaultPolicy,
  changes: { ...defaultPolicy.changes, require_test_before_implementation: true },
};

/** Proposes against whatever snapshot it is given, for whichever task is asking. */
function client() {
  return {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      if (system !== executionPrompts.implement) {
        return {
          decision: "pass",
          checks: Array.from({ length: 7 }, (_, index) => ({
            id: `E${index + 1}`,
            passed: true,
            finding: "Passed",
          })),
          findings: [],
        } as T;
      }
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      const id = context.task?.id ?? "T1";
      const path = id === "T1" ? "src/auth.test.ts" : "docs/README.md";
      const file = (context.files as Array<{ path: string; sha256: string }>).find(
        (item) => item.path === path,
      );
      return {
        task_id: id,
        status: "ready",
        summary: `Change ${path}`,
        blocker: null,
        traceability: [{ requirement_id: "R1", paths: [path] }],
        changes: [
          { path, operation: "modify", expected_sha256: file?.sha256, content: `new ${id}\n` },
        ],
      } as T;
    },
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-inherited-"));
  await Bun.write(join(root, "src/auth.test.ts"), "old\n");
  await Bun.write(join(root, "docs/README.md"), "old\n");
  // The suite this project runs is red from the start, standing in for the test task's own red.
  await Bun.write(join(root, "suite.ts"), "process.exit(3);\n");
  return root;
}

/** A red-by-design test task, and a docs task sharing its wave. */
function graph() {
  const [first, second] = readyTasks().tasks;
  if (!first || !second) throw new Error("Fixture must contain two tasks");
  const verification = [
    { command: { program: "bun", args: ["run", "suite.ts"] }, purpose: "Run the suite" },
  ];
  return [
    {
      ...first,
      id: "T1",
      acceptance: [],
      depends_on: [],
      files: { read: [], modify: ["src/auth.test.ts"], create: [] },
      verification,
      wave: 1,
      parallel: true,
    },
    {
      ...second,
      id: "T2",
      acceptance: [],
      depends_on: [],
      files: { read: [], modify: ["docs/README.md"], create: [] },
      verification,
      wave: 1,
      parallel: true,
    },
  ];
}

test("a sibling is not blamed for the red the test task left behind", async () => {
  let retriesOffered = 0;

  const journal = await executePlan(
    client(),
    await workspace(),
    readySpec(),
    readyPlan(),
    graph(),
    {
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        retriesOffered += 1;
        return false;
      },
    },
    testFirst,
    "trusted",
  );

  // T1 is red by design and passes; T2 changes only docs and inherits that red without causing it.
  expect(journal.tasks.map((task) => task.status)).toEqual(["completed", "completed"]);
  expect(retriesOffered).toBe(0);
  expect(journal.tasks[1]?.verification[0]?.output).toContain("not attributed to it");
});

test("without a deliberate red, a failing command still fails the task", async () => {
  let retriesOffered = 0;

  const journal = await executePlan(
    client(),
    await workspace(),
    readySpec(),
    readyPlan(),
    graph(),
    {
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        retriesOffered += 1;
        return false;
      },
    },
    // Test-first is off, so T1's red is not by design and nothing is excused.
    defaultPolicy,
    "trusted",
  );

  expect(journal.status).toBe("failed");
  expect(retriesOffered).toBe(1);
});
