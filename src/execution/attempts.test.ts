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

function passingTask() {
  const list = readyTasks();
  const [first] = list.tasks;
  if (!first) throw new Error("Fixture must contain a task");
  first.acceptance = [];
  first.verification = [{ command: { program: "bun", args: ["-e", ""] }, purpose: "Pass" }];
  return [first];
}

test("rolling a verified task back is bounded like every other retry", async () => {
  let rollbacks = 0;

  const journal = await executePlan(
    failingClient(),
    await workspace(),
    readySpec(),
    readyPlan(),
    passingTask(),
    {
      async review() {
        return { accepted: true };
      },
      async afterTask() {
        rollbacks += 1;
        // This path skipped the attempt counter entirely, so it could loop without end.
        return "rollback";
      },
      async retryAfterFailure() {
        return false;
      },
    },
    { ...defaultPolicy, execution: { ...defaultPolicy.execution, max_task_attempts: 2 } },
    "normal",
  );

  expect(journal.status).toBe("failed");
  expect(rollbacks).toBe(2);
  expect(journal.tasks[0]?.verification[0]?.output).toContain("Gave up on T1 after 2 attempts");
});

/** Proposes against whatever snapshot it was actually given, the way a model would. */
function snapshotAwareClient() {
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
      const file = (context.files as Array<{ path: string; sha256: string }>)[0];
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
            expected_sha256: file?.sha256,
            content: `new ${file?.sha256?.slice(0, 6)}\n`,
          },
        ],
      } as T;
    },
  };
}

test("a workspace that moved under a proposal is retried, not thrown", async () => {
  const root = await workspace();
  let attempts = 0;

  const journal = await executePlan(
    snapshotAwareClient(),
    root,
    readySpec(),
    readyPlan(),
    passingTask(),
    {
      async review() {
        attempts += 1;
        // Change the file behind the proposal exactly once, so the first apply finds a stale hash.
        if (attempts === 1) await Bun.write(join(root, "src/auth.ts"), "moved\n");
        return { accepted: true };
      },
      async retryAfterFailure() {
        return false;
      },
    },
    defaultPolicy,
    "normal",
  );

  // The run survived: the stale draw was a retry, and the second one applied cleanly.
  expect(journal.status).toBe("completed");
  expect(attempts).toBe(2);
});

test("a task whose proposal can never be produced ends the run as a journal", async () => {
  const journal = await executePlan(
    {
      async generateObject(): Promise<never> {
        throw new Error("Failed execution-implement", { cause: "provider is unreachable" });
      },
    },
    await workspace(),
    readySpec(),
    readyPlan(),
    passingTask(),
    {
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        return false;
      },
    },
    defaultPolicy,
    "trusted",
  );

  // It used to escape as an unhandled exception, taking the record of the run with it.
  expect(journal.status).toBe("failed");
  expect(journal.tasks[0]?.verification[0]?.output).toContain("provider is unreachable");
});
