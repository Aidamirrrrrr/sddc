import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { executionPrompts } from "./prompts";
import { executePlan } from "./runner";

/**
 * Always proposes a change whose verification will fail, against whatever snapshot it is given.
 *
 * Reading the supplied hash rather than a fixed one is what lets it survive the agent loop: from the
 * second turn on, the file on disk holds the previous turn's attempt.
 */
function failingClient() {
  return {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      if (system !== executionPrompts.implement) {
        return {
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
        traceability: [{ covers: "R1", paths: ["src/auth.ts"] }],
        changes: [
          {
            path: "src/auth.ts",
            operation: "modify",
            expected_sha256: file?.sha256,
            content: `attempt ${file?.sha256?.slice(0, 8)}\n`,
          },
        ],
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

/**
 * Moves the file out from under its own proposal, in the window the model call occupies.
 *
 * That window is where this really happens: a sibling's proposal was prefetched from an older
 * snapshot, or an editor saved while the model was thinking.
 */
function movingClient(root: string) {
  let moved = false;
  return {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      if (system !== executionPrompts.implement) {
        return {
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
      const proposal = {
        task_id: "T1",
        status: "ready",
        summary: "Change auth",
        blocker: null,
        traceability: [{ covers: "R1", paths: ["src/auth.ts"] }],
        changes: [
          {
            path: "src/auth.ts",
            operation: "modify",
            expected_sha256: file?.sha256,
            content: "changed\n",
          },
        ],
      };
      if (!moved) {
        moved = true;
        await Bun.write(join(root, "src/auth.ts"), "someone else got there first\n");
      }
      return proposal as T;
    },
  };
}

test("a workspace that moved under a proposal is retried, not thrown", async () => {
  const root = await workspace();
  let retries = 0;

  const journal = await executePlan(
    movingClient(root),
    root,
    readySpec(),
    readyPlan(),
    passingTask(),
    {
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        retries += 1;
        return false;
      },
    },
    defaultPolicy,
    "trusted",
  );

  // The stale draw is a retry, and the next one is built from the file as it now is.
  expect(journal.status).toBe("completed");
  expect(retries).toBe(0);
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("changed\n");
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
