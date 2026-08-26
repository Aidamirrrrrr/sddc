import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { runTaskAgent } from "./agent";
import { executionPrompts } from "./prompts";
import { finishCall, writeCall } from "./tool-fixtures";

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

/**
 * Writes what `write(turn, feedback)` returns, so a test can script how the model behaves.
 *
 * One turn of the agent is one run of the tool loop, and the shortest useful run is two calls:
 * write the file, then finish. The feedback the outer loop carried in is visible on the first.
 */
function scriptedClient(write: (turn: number, feedback: string) => string, seen: string[] = []) {
  let turn = 0;
  let step = 0;
  return {
    seen,
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
      const path = context.task.files.modify[0] as string;
      step += 1;
      if (step % 2 === 1) {
        turn += 1;
        const feedback = String(context.feedback ?? "");
        seen.push(feedback);
        return writeCall(path, write(turn, feedback)) as T;
      }
      return finishCall(`Change ${path}`, [{ covers: "R1", paths: [path] }]) as T;
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

test("a write outside the approved scope is refused, and the task never lands", async () => {
  const root = await workspace();
  const client = {
    async generateObject<T>(system: string): Promise<T> {
      if (system !== executionPrompts.implement) throw new Error("review should not be reached");
      // Keeps reaching for a file the task does not own. The tool refuses every time.
      return writeCall("suite.ts", "process.exit(0)\n") as T;
    },
  };

  // The loop is an agent, not an open one: the writable set is still exactly the task's own files,
  // and a task that spends its calls reaching past them produces nothing at all.
  await expect(runTaskAgent(options(root, client as never, 1))).rejects.toThrow("tool calls");
  expect(await Bun.file(join(root, "suite.ts")).text()).toContain("src/auth.ts");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("original\n");
});

test("a review rejection becomes the next turn's instruction, not a wasted draw", async () => {
  const root = await workspace();
  const seen: string[] = [];
  let reviews = 0;
  let writes = 0;
  const client = {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      if (system !== executionPrompts.implement) {
        reviews += 1;
        // Passes only once the second version is in front of it.
        const good = JSON.stringify(context.proposal).includes("revised");
        return {
          checks: Array.from({ length: 7 }, (_, index) => ({
            id: `E${index + 1}`,
            passed: good || index !== 4,
            finding: good ? "Passed" : "The error is swallowed",
          })),
          findings: good ? [] : ["Do not swallow the error"],
        } as T;
      }
      const path = context.task.files.modify[0] as string;
      writes += 1;
      if (writes % 2 === 1) {
        seen.push(String(context.feedback ?? ""));
        // Both versions satisfy the suite; only the reviewer separates them.
        return writeCall(path, seen.length === 1 ? "correct\n" : "correct revised\n") as T;
      }
      return finishCall("Change auth", [{ covers: "R1", paths: [path] }]) as T;
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
  let steps = 0;
  const client = {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      if (system !== executionPrompts.implement) {
        order.push("review");
        return {
          checks: Array.from({ length: 7 }, (_, index) => ({
            id: `E${index + 1}`,
            passed: true,
            finding: "Passed",
          })),
          findings: [],
        } as T;
      }
      const path = context.task.files.modify[0] as string;
      steps += 1;
      if (steps % 2 === 1) {
        order.push("implement");
        return writeCall(path, steps === 1 ? "wrong\n" : "correct\n") as T;
      }
      return finishCall("Change auth", [{ covers: "R1", paths: [path] }]) as T;
    },
  };

  await runTaskAgent(options(root, client as never, 3));

  // The first attempt failed its command and was corrected without ever costing a review call.
  expect(order).toEqual(["implement", "implement", "review"]);
});

test("a turn that cannot be drawn falls back to work that already came out right", async () => {
  const root = await workspace();
  let implementCalls = 0;
  const client = {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      if (system !== executionPrompts.implement) {
        // Always objects, so the loop always asks for another turn.
        return {
          checks: Array.from({ length: 7 }, (_, index) => ({
            id: `E${index + 1}`,
            passed: index !== 0,
            finding: "The criterion is not fully covered",
          })),
          findings: ["Cover the criterion properly"],
        } as T;
      }
      implementCalls += 1;
      // The first turn writes and finishes; from the second on, nothing can be drawn at all.
      if (implementCalls > 2) throw new Error("Failed execution-implement");
      const path = context.task.files.modify[0] as string;
      return (
        implementCalls === 1
          ? writeCall(path, "correct\n")
          : finishCall("Change auth", [{ covers: "R1", paths: [path] }])
      ) as T;
    },
  };

  const outcome = await runTaskAgent(options(root, client as never, 3));

  // The good turn used to be thrown away here, leaving a failed task whose transcript was green.
  expect(outcome.kind).toBe("exhausted");
  if (outcome.kind !== "exhausted") throw new Error("expected exhausted");
  expect(outcome.turn.proposal.changes[0]?.content).toBe("correct\n");
  const note = outcome.turn.verification.at(-1);
  expect(note?.program).toBe("sddc");
  expect(note?.output).toContain("the code review refused");
  expect(note?.output).toContain("Cover the criterion properly");
});
