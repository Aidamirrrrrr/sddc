import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Task } from "../tasks/schemas";
import type { ExecutionTaskResult } from "./schemas";

type VerificationOptions = {
  policy?: Policy;
  approve?: (verification: Task["verification"][number]) => Promise<boolean>;
  /** Injected so tests do not actually wait out the escalation. */
  killGraceMs?: number;
};

/**
 * How long a command that was told to stop has to actually stop.
 *
 * SIGTERM is a request, and a process is free to ignore it — so the timeout that exists to bound the
 * run could sit on `exited` forever, which is the one thing a timeout must never do. SIGKILL cannot
 * be ignored, so the wait is bounded by escalating to it rather than by hoping.
 */
const KILL_GRACE_MS = 5_000;

/** Conventional exit code for a command ended by a timeout, matching `timeout(1)`. */
const TIMEOUT_EXIT_CODE = 124;

/**
 * Whether a command actually ran and reached a verdict of its own.
 *
 * 126 and 127 mean it could not be executed at all, and anything above 128 means a signal killed
 * it. None of those is a failing check — they are the absence of one, which is a different fact and
 * calls for a different answer.
 *
 * Shared deliberately, because two rules depend on this distinction and drifting apart would make
 * them contradict each other: whether an inverted test-first expectation was met, and whether a
 * failure predates the task being blamed for it.
 */
export function ranToCompletion(item: { exit_code: number; timed_out: boolean }): boolean {
  return !item.timed_out && item.exit_code < 126;
}

type CommandOutcome = Omit<ExecutionTaskResult["verification"][number], "program" | "args">;

export async function runVerification(
  root: string,
  task: Task,
  options: VerificationOptions = {},
): Promise<ExecutionTaskResult["verification"]> {
  const policy = options.policy ?? defaultPolicy;
  const results: ExecutionTaskResult["verification"] = [];
  for (const item of task.verification) {
    // Checked again here, where the process is actually spawned. Every path into this function
    // validates the graph against the policy first, so this can only ever fire on a task graph that
    // reached the runner without that happening — which is exactly the case a guard is for, given
    // that tasks.yaml is read back from disk and is meant to be edited by hand.
    if (!policy.commands.allowed_programs.includes(item.command.program)) {
      results.push({
        program: item.command.program,
        args: item.command.args,
        exit_code: 126,
        timed_out: false,
        output: `Program is not allowed by project policy: ${item.command.program}`,
      });
      break;
    }
    if (options.approve && !(await options.approve(item))) {
      results.push({
        program: item.command.program,
        args: item.command.args,
        exit_code: 126,
        timed_out: false,
        output: "Command rejected by user",
      });
      break;
    }
    const outcome = await runCommand(root, item.command, {
      timeoutMs: policy.execution.command_timeout_seconds * 1_000,
      killGraceMs: options.killGraceMs ?? KILL_GRACE_MS,
    });
    results.push({ program: item.command.program, args: item.command.args, ...outcome });
    if (outcome.exit_code !== 0) break;
  }
  return results;
}

async function runCommand(
  root: string,
  command: Task["verification"][number]["command"],
  bounds: { timeoutMs: number; killGraceMs: number },
): Promise<CommandOutcome> {
  const child = Bun.spawn([command.program, ...command.args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: verificationEnvironment(),
  });
  let timedOut = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
    escalation = setTimeout(() => child.kill("SIGKILL"), bounds.killGraceMs);
  }, bounds.timeoutMs);

  const collected = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  // Reading the pipes is abandoned rather than awaited past the deadline: a grandchild that outlives
  // the process holds the inherited pipe open, so the read can outlast the process killed to end the
  // wait. Killing the child bounds the child; only this bounds the call.
  let abandon: ReturnType<typeof setTimeout> | undefined;
  const abandoned = new Promise<undefined>((resolve) => {
    abandon = setTimeout(() => resolve(undefined), bounds.timeoutMs + bounds.killGraceMs * 2);
  });

  try {
    const settled = await Promise.race([collected, abandoned]);
    if (!settled) {
      return {
        exit_code: TIMEOUT_EXIT_CODE,
        timed_out: true,
        output: `Command did not exit within ${Math.round(bounds.timeoutMs / 1_000)}s and was killed`,
      };
    }
    const [stdout, stderr, exitCode] = settled;
    return {
      exit_code: timedOut && exitCode === 0 ? TIMEOUT_EXIT_CODE : exitCode,
      timed_out: timedOut,
      output: limitOutput(`${stdout}${stderr}`.trim()),
    };
  } finally {
    clearTimeout(timer);
    if (escalation) clearTimeout(escalation);
    if (abandon) clearTimeout(abandon);
  }
}

function verificationEnvironment(): Record<string, string> {
  const allowed = ["CI", "HOME", "LANG", "LC_ALL", "NODE_ENV", "PATH", "TEMP", "TMP", "TMPDIR"];
  return Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] === undefined ? [] : ([[name, process.env[name]]] as const),
    ),
  );
}

function limitOutput(output: string): string {
  const limit = 16_000;
  return output.length <= limit ? output : `${output.slice(0, limit)}\n[output truncated]`;
}
