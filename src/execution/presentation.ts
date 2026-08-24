import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { ChangeProposal, ExecutionJournal } from "./schemas";

export function contractSummary(plan: ImplementationPlan, policy: Policy): string {
  const modified = new Set(plan.tasks.flatMap((task) => task.files.modify));
  const created = new Set(plan.tasks.flatMap((task) => task.files.create));
  const permissions = new Set(plan.tasks.flatMap((task) => task.permissions));
  const commands = plan.tasks.flatMap((task) =>
    task.verification.map((item) => `${item.command.program} ${item.command.args.join(" ")}`),
  );
  return [
    `Feature: ${plan.feature}`,
    `Tasks: ${plan.tasks.length}`,
    `Files: ${modified.size} modified, ${created.size} created`,
    `Permissions: ${[...permissions].join(", ") || "none"}`,
    `Commands: ${commands.join("; ")}`,
    `Network: ${policy.commands.allow_external_network ? "allowed by policy" : "blocked"}`,
  ].join("\n");
}

export function traceability(proposal: ChangeProposal): string {
  return proposal.traceability
    .map((item) => `${item.requirement_id} -> ${item.paths.join(", ")}`)
    .join("\n");
}

export function formatVerification(
  verification: ExecutionJournal["tasks"][number]["verification"],
): string {
  return verification
    .map(
      (item) =>
        `$ ${item.program} ${item.args.join(" ")}\nexit ${item.exit_code}${item.timed_out ? " (timeout)" : ""}${item.output ? `\n${item.output}` : ""}`,
    )
    .join("\n\n");
}

export function finalSummary(journal: ExecutionJournal): string {
  return journal.tasks
    .map(
      (task) =>
        `${task.task_id}: ${task.status}\nfiles: ${task.changed_files.join(", ")}\nchecks: ${task.verification.map((item) => `${item.program}=${item.exit_code}`).join(", ")}`,
    )
    .join("\n\n");
}

export async function workingDiff(root: string): Promise<string> {
  const process = Bun.spawn(["git", "diff", "--no-ext-diff", "--"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) return "Git diff unavailable";
  const limit = 30_000;
  return stdout.length <= limit
    ? stdout || "No uncommitted diff"
    : `${stdout.slice(0, limit)}\n[diff truncated]`;
}
