import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { ranToCompletion, runVerification } from "./verify";

const oneSecond = {
  ...defaultPolicy,
  execution: { ...defaultPolicy.execution, command_timeout_seconds: 1 },
};

function taskRunning(...commands: Array<{ program: string; args: string[] }>): Task {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  return {
    ...task,
    verification: commands.map((command) => ({ command, purpose: "Check" })),
  };
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sddc-verify-"));
}

test("a command's exit code and output are reported as they came out", async () => {
  const task = taskRunning({ program: "bun", args: ["-e", "console.log('hi'); process.exit(3)"] });

  const [result] = await runVerification(await workspace(), task, { policy: oneSecond });

  expect(result?.exit_code).toBe(3);
  expect(result?.timed_out).toBe(false);
  expect(result?.output).toContain("hi");
});

test("a command that ignores SIGTERM is still bounded", async () => {
  // The whole point of a timeout: SIGTERM is a request, and this command refuses it. Before the
  // escalation the run sat on `exited` forever — the one thing the bound exists to prevent.
  const task = taskRunning({
    program: "bun",
    args: ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60_000)"],
  });

  const started = Date.now();
  const [result] = await runVerification(await workspace(), task, {
    policy: oneSecond,
    killGraceMs: 100,
  });

  expect(result?.timed_out).toBe(true);
  expect(result?.exit_code).not.toBe(0);
  // Generous, because the assertion is that it returns at all rather than how fast.
  expect(Date.now() - started).toBeLessThan(20_000);
}, 30_000);

test("a rejected command is recorded and stops the sequence", async () => {
  const task = taskRunning(
    { program: "bun", args: ["-e", "process.exit(0)"] },
    { program: "bun", args: ["-e", "process.exit(0)"] },
  );

  const results = await runVerification(await workspace(), task, {
    policy: oneSecond,
    approve: async () => false,
  });

  expect(results).toHaveLength(1);
  expect(results[0]?.exit_code).toBe(126);
  expect(results[0]?.output).toBe("Command rejected by user");
});

test("a failing command stops the sequence before the next one runs", async () => {
  const task = taskRunning(
    { program: "bun", args: ["-e", "process.exit(1)"] },
    { program: "bun", args: ["-e", "process.exit(0)"] },
  );

  const results = await runVerification(await workspace(), task, { policy: oneSecond });

  expect(results).toHaveLength(1);
  expect(results[0]?.exit_code).toBe(1);
});

test("a program outside the policy allowlist is never spawned", async () => {
  const root = await workspace();
  // The task graph is validated against the policy before it ever reaches the runner, so this can
  // only fire on a tasks.yaml that got here without that — which is the case a guard exists for,
  // given the file is read back from disk and meant to be edited by hand.
  const task = taskRunning({ program: "sh", args: ["-c", `touch ${join(root, "escaped")}`] });

  const [result] = await runVerification(root, task, { policy: oneSecond });

  expect(result?.exit_code).toBe(126);
  expect(result?.output).toContain("not allowed by project policy");
  expect(await Bun.file(join(root, "escaped")).exists()).toBe(false);
});

test("only an ordinary exit code means the command reached a verdict", () => {
  // The shared line between "this check failed" and "there was no check". Two rules depend on it —
  // the inverted test-first expectation and inherited-failure attribution — so it lives in one
  // place and is asserted in one place.
  expect(ranToCompletion({ exit_code: 0, timed_out: false })).toBe(true);
  expect(ranToCompletion({ exit_code: 1, timed_out: false })).toBe(true);
  expect(ranToCompletion({ exit_code: 125, timed_out: false })).toBe(true);

  expect(ranToCompletion({ exit_code: 126, timed_out: false })).toBe(false);
  expect(ranToCompletion({ exit_code: 127, timed_out: false })).toBe(false);
  expect(ranToCompletion({ exit_code: 139, timed_out: false })).toBe(false);
  expect(ranToCompletion({ exit_code: 1, timed_out: true })).toBe(false);
});
