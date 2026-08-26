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

/**
 * Strict mode promises that every verification command is confirmed, and a task holding
 * external_network is confirmed in every mode. The baseline prong ran the task's commands directly,
 * before the hook was ever consulted — so the promise held for the loop and not for the run.
 *
 * The command here leaves a marker behind, which is the only honest way to ask whether it ran.
 */
const MARKER = "ran-without-asking";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-approval-"));
  await Bun.write(join(root, "src/auth.ts"), "original\n");
  await Bun.write(join(root, "suite.ts"), `await Bun.write("${MARKER}", "1");\nprocess.exit(1);\n`);
  return root;
}

function task() {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return {
    ...first,
    acceptance: [],
    requirements: ["R1"],
    files: { read: [], modify: ["src/auth.ts"], create: [], delete: [] },
    verification: [{ command: { program: "bun", args: ["run", "suite.ts"] }, purpose: "Suite" }],
  };
}

function client() {
  let step = 0;
  return {
    async generateObject<T>(system: string): Promise<T> {
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
      step += 1;
      return (
        step % 2 === 1
          ? writeCall("src/auth.ts", "changed\n")
          : finishCall("Change src/auth.ts", [{ covers: "R1", paths: ["src/auth.ts"] }])
      ) as T;
    },
  };
}

function run(root: string, approveCommand: () => Promise<boolean>) {
  return runTaskAgent({
    client: client(),
    root,
    spec: readySpec(),
    plan: readyPlan(),
    task: task(),
    policy: { ...defaultPolicy, execution: { ...defaultPolicy.execution, max_task_iterations: 1 } },
    graph: [task()],
    // The condition that makes the baseline run at all: an earlier task left the suite red on
    // purpose, which is the ordinary state under test-first.
    stage: { suiteRedByDesign: true },
    feedback: "",
    approveCommand,
  });
}

test("a refused command never runs, not even as the baseline", async () => {
  const root = await workspace();
  let asked = 0;

  const outcome = await run(root, async () => {
    asked += 1;
    return false;
  });

  expect(await Bun.file(join(root, MARKER)).exists()).toBe(false);
  expect(asked).toBe(1);
  expect(outcome.kind).not.toBe("settled");
});

test("an approved command is confirmed once for the whole task", async () => {
  const root = await workspace();
  let asked = 0;

  await run(root, async () => {
    asked += 1;
    return true;
  });

  // Once for the task, covering the baseline and every turn after it. Asking per run of the command
  // would make strict mode unusable without making it any stricter.
  expect(asked).toBe(1);
  expect(await Bun.file(join(root, MARKER)).exists()).toBe(true);
});
