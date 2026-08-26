import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { assignWaves } from "../tasks/validate";
import { sha256 } from "./context";
import { executionPrompts } from "./prompts";
import { executePlan } from "./runner";

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

function proposal(id: string, path: string, requirement: string, acceptance: string) {
  return {
    task_id: id,
    status: "ready",
    summary: `Change ${path}`,
    blocker: null,
    needs_files: null,
    traceability: [
      { covers: requirement, paths: [path] },
      { covers: acceptance, paths: [path] },
    ],
    changes: [
      { path, operation: "modify", expected_sha256: sha256("old\n"), content: `new ${id}\n` },
    ],
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

/** Dispatches on the task the prompt carries rather than on call order, which prefetching changes. */
function keyedClient(record: (event: string) => void) {
  return {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      // Parse the context rather than grepping it: a task's context now names its siblings too, so a
      // substring match would read T1's call as T2's.
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      const id = context.task?.id ?? context.proposal?.task_id ?? "T1";
      if (system === executionPrompts.implement) {
        record(`generate:${id}`);
        const path = id === "T1" ? "src/a.ts" : "src/b.ts";
        const requirement = id === "T1" ? "R1" : "R2";
        const acceptance = id === "T1" ? "A1" : "A2";
        return proposal(id, path, requirement, acceptance) as T;
      }
      return passedReview() as T;
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

function spec() {
  const value = readySpec();
  value.requirements.push({ id: "R2", statement: "A user can sign in" });
  value.acceptance.push({ id: "A2", verifies: ["R2"], statement: "Sign-in succeeds" });
  return value;
}

test("an independent sibling is generated while the current task waits for review", async () => {
  const events: string[] = [];
  const root = await workspace();
  let releaseReview: (() => void) | undefined;
  const firstReviewReached = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });

  const run = executePlan(
    keyedClient((event) => events.push(event)),
    root,
    spec(),
    readyPlan(),
    twoIndependentTasks(),
    {
      async review(task) {
        events.push(`review:${task.id}`);
        if (task.id === "T1") {
          releaseReview?.();
          // Hold T1 at the prompt so the sibling has a window to be generated.
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        events.push(`review:${task.id}:done`);
        return { accepted: true };
      },
      async retryAfterFailure() {
        return false;
      },
    },
    defaultPolicy,
    "normal",
  );

  await firstReviewReached;
  await run;

  // The point of prefetching: the sibling's proposal exists before the user finishes reviewing T1.
  expect(events.indexOf("generate:T2")).toBeLessThan(events.indexOf("review:T1:done"));
  // And it is generated once, not again when T2 is reached.
  expect(events.filter((event) => event === "generate:T2")).toHaveLength(1);
  expect(events.indexOf("review:T2")).toBeGreaterThan(events.indexOf("review:T1:done"));
});

test("strict mode never generates a task before its scope is approved", async () => {
  const events: string[] = [];
  const root = await workspace();
  const approvals: string[] = [];

  await executePlan(
    keyedClient((event) => events.push(event)),
    root,
    spec(),
    readyPlan(),
    twoIndependentTasks(),
    {
      async approveScope(task) {
        approvals.push(task.id);
        return true;
      },
      async review() {
        return { accepted: true };
      },
      async approveCommand() {
        return true;
      },
      async retryAfterFailure() {
        return false;
      },
    },
    defaultPolicy,
    "strict",
  );

  // Nothing is generated for T2 until T1 is finished and T2's own scope has been approved.
  expect(events).toEqual(["generate:T1", "generate:T2"]);
  expect(approvals).toEqual(["T1", "T2"]);
});
