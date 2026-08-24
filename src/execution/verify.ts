import { defaultPolicy } from "../policy/load";
import type { Policy } from "../policy/schemas";
import type { Task } from "../tasks/schemas";
import type { ExecutionTaskResult } from "./schemas";

type VerificationOptions = {
  policy?: Policy;
  approve?: (verification: Task["verification"][number]) => Promise<boolean>;
};

export async function runVerification(
  root: string,
  task: Task,
  options: VerificationOptions = {},
): Promise<ExecutionTaskResult["verification"]> {
  const policy = options.policy ?? defaultPolicy;
  const results: ExecutionTaskResult["verification"] = [];
  for (const item of task.verification) {
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
    const process = Bun.spawn([item.command.program, ...item.command.args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: verificationEnvironment(),
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.kill();
    }, policy.execution.command_timeout_seconds * 1_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    clearTimeout(timer);
    results.push({
      program: item.command.program,
      args: item.command.args,
      exit_code: exitCode,
      timed_out: timedOut,
      output: limitOutput(`${stdout}${stderr}`.trim()),
    });
    if (exitCode !== 0) break;
  }
  return results;
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
