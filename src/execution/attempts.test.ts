import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { sha256 } from "./context";
import { executionPrompts } from "./prompts";
import { executePlan } from "./runner";

/** Always proposes a change whose verification will fail. */
function failingClient() {
  return {
    async generateObject<T>(system: string): Promise<T> {
      if (system === executionPrompts.implement) {
        return {
          task_id: "T1",
          status: "ready",
          summary: "Change auth",
          blocker: null,
          traceability: [{ requirement_id: "R1", paths: ["src/auth.ts"] }],
          changes: [
            {
              path: "src/auth.ts",
              operation: "modify",
              expected_sha256: sha256("old\n"),
              content: "new\n",
            },
          ],
        } as T;
      }
      return {
        decision: "pass",
        checks: Array.from({ length: 7 }, (_, index) => ({
          id: `E${index + 1}`,
          passed: true,
          finding: "Passed",
        })),
        findings: [],
      } as T;
    },
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-attempts-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  return root;
}

function alwaysFailingTask() {
  const list = readyTasks();
  const [first] = list.tasks;
  if (!first) throw new Error("Fixture must contain a task");
  first.acceptance = [];
  first.verification = [
    { command: { program: "bun", args: ["-e", "process.exit(7)"] }, purpose: "Fail" },
  ];
  return [first];
}

test("a task that never verifies is abandoned at the policy limit", async () => {
  let asked = 0;

  const journal = await executePlan(
    failingClient(),
    await workspace(),
    readySpec(),
    readyPlan(),
    alwaysFailingTask(),
    {
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        asked += 1;
        // Something that always says yes used to keep the run going forever.
        return true;
      },
    },
    { ...defaultPolicy, execution: { ...defaultPolicy.execution, max_task_attempts: 3 } },
    "normal",
  );

  expect(journal.status).toBe("failed");
  expect(asked).toBe(3);
  expect(journal.tasks[0]?.verification[0]?.output).toContain("Gave up on T1 after 3 attempts");
});

test("declining a retry still ends the run at the first failure", async () => {
  let asked = 0;

  const journal = await executePlan(
    failingClient(),
    await workspace(),
    readySpec(),
    readyPlan(),
    alwaysFailingTask(),
    {
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        asked += 1;
        return false;
      },
    },
    defaultPolicy,
    "normal",
  );

  expect(journal.status).toBe("failed");
  expect(asked).toBe(1);
});
