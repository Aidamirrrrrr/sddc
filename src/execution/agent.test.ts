import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { runTaskAgent } from "./agent";
import { executionPrompts } from "./prompts";

const policy = (iterations: number) => ({
  ...defaultPolicy,
  execution: { ...defaultPolicy.execution, max_task_iterations: iterations },
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-agent-"));
  await Bun.write(join(root, "src/auth.ts"), "original\n");
  // Passes only once the file says "correct"; stands in for a real suite.
  await Bun.write(
    join(root, "suite.ts"),
    'const text = await Bun.file("src/auth.ts").text();\nprocess.exit(text.includes("correct") ? 0 : 1);\n',
  );
  return root;
}

function task() {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return {
    ...first,
    acceptance: [],
    requirements: ["R1"],
    files: { read: [], modify: ["src/auth.ts"], create: [] },
    verification: [{ command: { program: "bun", args: ["run", "suite.ts"] }, purpose: "Suite" }],
  };
}

/** Writes what `write(turn, feedback)` returns, so a test can script how the model behaves. */
function scriptedClient(write: (turn: number, feedback: string) => string, seen: string[] = []) {
  let turn = 0;
  return {
    seen,
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
      const path = context.task.files.modify[0] as string;
      const file = (context.files as Array<{ path: string; sha256: string }>).find(
        (item) => item.path === path,
      );
      turn += 1;
      seen.push(String(context.feedback ?? ""));
      return {
        task_id: context.task.id,
        status: "ready",
        summary: `Change ${path}`,
        blocker: null,
        traceability: [{ covers: "R1", paths: [path] }],
        changes: [
          {
            path,
            operation: "modify",
            expected_sha256: file?.sha256,
            content: write(turn, String(context.feedback ?? "")),
          },
        ],
      } as T;
    },
  };
}

function options(root: string, client: ReturnType<typeof scriptedClient>, iterations: number) {
  const current = task();
  return {
    client,
    root,
    spec: readySpec(),
    plan: readyPlan(),
    task: current,
    policy: policy(iterations),
    graph: [current],
    stage: {},
    feedback: "",
  };
}

test("a task corrects itself against the output its own code produced", async () => {
  const root = await workspace();
  const seen: string[] = [];
  // First attempt is wrong; the second is written only because the first one's failure came back.
  const client = scriptedClient((turn, feedback) => {
    if (turn === 1) return "wrong\n";
    return feedback.includes("exit 1") ? "correct\n" : "wrong again\n";
  }, seen);

  const outcome = await runTaskAgent(options(root, client, 3));

  expect(outcome.kind).toBe("settled");
  if (outcome.kind !== "settled") throw new Error("expected settled");
  expect(outcome.turns).toBe(2);
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("correct\n");
  // The second turn was handed the real transcript, not a summary of it.
  expect(seen[1]).toContain("exit 1");
  expect(seen[1]).toContain("$ bun run suite.ts");
});

test("the loop stops at the policy budget", async () => {
  const root = await workspace();
  const client = scriptedClient((turn) => `wrong ${turn}\n`);

  const outcome = await runTaskAgent(options(root, client, 2));

  expect(outcome.kind).toBe("exhausted");
  if (outcome.kind !== "exhausted") throw new Error("expected exhausted");
  expect(outcome.turns).toBe(2);
});

test("abandoning a task restores every turn it wrote, not only the last", async () => {
  const root = await workspace();
  const client = scriptedClient((turn) => `wrong ${turn}\n`);

  const outcome = await runTaskAgent(options(root, client, 3));
  if (outcome.kind !== "exhausted") throw new Error("expected exhausted");
  const { restoreFiles } = await import("./files");
  await restoreFiles(root, outcome.backup);

  // Three turns wrote the file; one restore has to undo all of them.
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("original\n");
});

test("a turn that writes outside the approved scope is rejected, not applied", async () => {
  const root = await workspace();
  const client = {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      if (system !== executionPrompts.implement) throw new Error("review should not be reached");
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      return {
        task_id: context.task.id,
        status: "ready",
        summary: "Reach past the scope",
        blocker: null,
        traceability: [{ covers: "R1", paths: ["suite.ts"] }],
        changes: [
          {
            path: "suite.ts",
            operation: "modify",
            expected_sha256: null,
            content: "process.exit(0)\n",
          },
        ],
      } as T;
    },
  };

  // The loop is an agent, not an open one: the writable set is still exactly the task's own files.
  expect(runTaskAgent(options(root, client as never, 3))).rejects.toThrow(
    "may not modify suite.ts",
  );
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("original\n");
});

test("under test-first the loop is satisfied by red, and keeps going while green", async () => {
  const root = await workspace();
  const testFirst = {
    ...defaultPolicy,
    changes: { ...defaultPolicy.changes, require_test_before_implementation: true },
  };
  const current = { ...task(), files: { read: [], modify: ["src/auth.test.ts"], create: [] } };
  await Bun.write(join(root, "src/auth.test.ts"), "original\n");
  await Bun.write(
    join(root, "suite.ts"),
    'const text = await Bun.file("src/auth.test.ts").text();\nprocess.exit(text.includes("asserts") ? 1 : 0);\n',
  );
  const client = scriptedClient((turn) => (turn === 1 ? "passes\n" : "asserts\n"));

  const outcome = await runTaskAgent({
    client,
    root,
    spec: readySpec(),
    plan: readyPlan(),
    task: current,
    policy: { ...testFirst, execution: { ...testFirst.execution, max_task_iterations: 3 } },
    graph: [current],
    stage: {},
    feedback: "",
  });

  // A green suite is the failure here, so the first turn is rejected and the second one lands.
  expect(outcome.kind).toBe("settled");
  if (outcome.kind !== "settled") throw new Error("expected settled");
  expect(outcome.turns).toBe(2);
});

test("a review rejection becomes the next turn's instruction, not a wasted draw", async () => {
  const root = await workspace();
  const seen: string[] = [];
  let reviews = 0;
  const client = {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      if (system !== executionPrompts.implement) {
        reviews += 1;
        // Passes only once the second version is in front of it.
        const good = JSON.stringify(context.proposal).includes("revised");
        return {
          decision: good ? "pass" : "reject",
          checks: Array.from({ length: 7 }, (_, index) => ({
            id: `E${index + 1}`,
            passed: good || index !== 4,
            finding: good ? "Passed" : "The error is swallowed",
          })),
          findings: good ? [] : ["Do not swallow the error"],
        } as T;
      }
      const path = context.task.files.modify[0] as string;
      const file = (context.files as Array<{ path: string; sha256: string }>).find(
        (item) => item.path === path,
      );
      seen.push(String(context.feedback ?? ""));
      return {
        task_id: context.task.id,
        status: "ready",
        summary: "Change auth",
        blocker: null,
        traceability: [{ covers: "R1", paths: [path] }],
        changes: [
          {
            path,
            operation: "modify",
            expected_sha256: file?.sha256,
            // Both versions satisfy the suite; only the reviewer separates them.
            content: seen.length === 1 ? "correct\n" : "correct revised\n",
          },
        ],
      } as T;
    },
  };

  const outcome = await runTaskAgent(options(root, client as never, 3));

  expect(outcome.kind).toBe("settled");
  if (outcome.kind !== "settled") throw new Error("expected settled");
  expect(outcome.turns).toBe(2);
  expect(reviews).toBe(2);
  // The reviewer's own words drove the correction.
  expect(seen[1]).toContain("Do not swallow the error");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("correct revised\n");
});

test("the reviewer only ever sees a change that already passed its commands", async () => {
  const root = await workspace();
  const order: string[] = [];
  const client = {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      if (system !== executionPrompts.implement) {
        order.push("review");
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
      order.push("implement");
      const path = context.task.files.modify[0] as string;
      const file = (context.files as Array<{ path: string; sha256: string }>).find(
        (item) => item.path === path,
      );
      return {
        task_id: context.task.id,
        status: "ready",
        summary: "Change auth",
        blocker: null,
        traceability: [{ covers: "R1", paths: [path] }],
        changes: [
          {
            path,
            operation: "modify",
            expected_sha256: file?.sha256,
            content:
              order.filter((item) => item === "implement").length === 1 ? "wrong\n" : "correct\n",
          },
        ],
      } as T;
    },
  };

  await runTaskAgent(options(root, client as never, 3));

  // The first attempt failed its command and was corrected without ever costing a review call.
  expect(order).toEqual(["implement", "implement", "review"]);
});
