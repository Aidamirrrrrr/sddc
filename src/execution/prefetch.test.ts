import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { assignWaves } from "../tasks/validate";
import { executionPrompts } from "./prompts";
import { executePlan } from "./runner";
import { finishCall, writeCall } from "./tool-fixtures";

/**
 * What prefetching is now, and what it deliberately is not.
 *
 * It used to generate an independent sibling's whole proposal while the current task waited for
 * review. A task that runs commands as it works cannot be prepared that way: its commands would run
 * before the user had reached the task at all — unacceptable in strict mode, surprising in every
 * other. So only the reading happens ahead of time, and the model is not consulted until the task
 * is genuinely reached.
 */
function task(id: string, path: string, requirement: string, acceptance: string): Task {
  return {
    id,
    title: `Change ${path}`,
    goal: `Change ${path}`,
    requirements: [requirement],
    acceptance: [acceptance],
    depends_on: [],
    permissions: [],
    files: { read: [path], modify: [path], create: [] },
    verification: [{ command: { program: "bun", args: ["-e", ""] }, purpose: "check" }],
    done_when: ["done"],
    risks: [],
    wave: 1,
    parallel: true,
  };
}

function passedReview() {
  return {
    checks: Array.from({ length: 7 }, (_, index) => ({
      id: `E${index + 1}`,
      passed: true,
      finding: "Passed",
    })),
    findings: [],
  };
}

/** Dispatches on the task the prompt carries rather than on call order. */
function keyedClient(record: (event: string) => void) {
  const steps = new Map<string, number>();
  return {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      const id = String(context.task?.id ?? context.proposal?.task_id ?? "T?");
      if (system !== executionPrompts.implement) {
        record(`review:${id}`);
        return passedReview() as T;
      }
      const path = id === "T1" ? "src/a.ts" : "src/b.ts";
      const requirement = id === "T1" ? "R1" : "R2";
      const acceptance = id === "T1" ? "A1" : "A2";
      const step = (steps.get(id) ?? 0) + 1;
      steps.set(id, step);
      if (step === 1) {
        record(`generate:${id}`);
        return writeCall(path, `new ${id}\n`) as T;
      }
      return finishCall(`Change ${path}`, [
        { covers: requirement, paths: [path] },
        { covers: acceptance, paths: [path] },
      ]) as T;
    },
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-prefetch-"));
  await Bun.write(join(root, "src/a.ts"), "old\n");
  await Bun.write(join(root, "src/b.ts"), "old\n");
  return root;
}

function twoIndependentTasks(): Task[] {
  return assignWaves([task("T1", "src/a.ts", "R1", "A1"), task("T2", "src/b.ts", "R2", "A2")]);
}

test("a sibling is not consulted before its own task is reached", async () => {
  const root = await workspace();
  const events: string[] = [];

  await executePlan(
    keyedClient((event) => events.push(event)),
    root,
    readySpec(),
    readyPlan(),
    twoIndependentTasks(),
    {
      async review(currentTask) {
        events.push(`review:${currentTask.id}:done`);
        return { accepted: true };
      },
      async retryAfterFailure() {
        return false;
      },
    },
    defaultPolicy,
    "normal",
  );

  // The sibling's files may be read early; its model calls may not be made early. Generating a
  // proposal ahead of time would now mean running that task's commands ahead of time.
  expect(events.indexOf("generate:T2")).toBeGreaterThan(events.indexOf("review:T1:done"));
  expect(events.filter((event) => event === "generate:T2")).toHaveLength(1);
});

test("strict mode still consults nothing before the scope is approved", async () => {
  const root = await workspace();
  const events: string[] = [];
  const approvals: string[] = [];

  await executePlan(
    keyedClient((event) => events.push(event)),
    root,
    readySpec(),
    readyPlan(),
    twoIndependentTasks(),
    {
      async approveScope(currentTask) {
        approvals.push(currentTask.id);
        return true;
      },
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        return false;
      },
      async approveCommand() {
        return true;
      },
    },
    defaultPolicy,
    "strict",
  );

  expect(events.filter((event) => event.startsWith("generate:"))).toEqual([
    "generate:T1",
    "generate:T2",
  ]);
  expect(approvals).toEqual(["T1", "T2"]);
});
