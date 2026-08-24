import {
  autocompleteMultiselect,
  cancel,
  confirm,
  isCancel,
  note,
  select,
  text,
} from "@clack/prompts";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import {
  contractSummary,
  finalSummary,
  formatVerification,
  traceability,
  workingDiff,
} from "./presentation";
import type { ExecutionHooks } from "./runner";
import type { ExecutionJournal } from "./schemas";

export async function configureExecution(
  root: string,
  plan: ImplementationPlan,
  policy: Policy,
): Promise<{ mode: ExecutionJournal["mode"]; hooks: ExecutionHooks } | null> {
  note(contractSummary(plan, policy), "Implementation contract");
  if (!unwrap(await confirm({ message: "Start implementation?", initialValue: false })))
    return null;
  const mode = unwrap(
    await select({
      message: "Approval mode",
      initialValue: policy.execution.default_approval_mode,
      options: [
        { value: "strict", label: "Strict", hint: "approve files and every command" },
        { value: "normal", label: "Normal", hint: "approve each task diff" },
        { value: "trusted", label: "Trusted", hint: "automatic diffs; verification still runs" },
      ],
    }),
  ) as ExecutionJournal["mode"];

  return { mode, hooks: createHooks(root, mode, policy) };
}

function createHooks(root: string, mode: ExecutionJournal["mode"], policy: Policy): ExecutionHooks {
  return {
    async approveScope(task) {
      if (mode !== "strict") return true;
      const files = [...task.files.modify, ...task.files.create];
      const selected = unwrap(
        await autocompleteMultiselect({
          message: `${task.id} approved write scope`,
          initialValues: files,
          required: true,
          options: files.map((path) => ({
            value: path,
            label: path,
            hint: task.files.create.includes(path) ? "create" : "modify",
          })),
        }),
      );
      if (selected.length === files.length) return true;
      note("Scope changed. Revise the accepted plan before implementation.", "Execution blocked");
      return false;
    },
    async review(task, proposal, diff) {
      console.log(`\nTask ${task.id}: ${task.title}\n${traceability(proposal)}\n${diff}\n`);
      if (mode === "strict") {
        const paths = proposal.changes.map((change) => change.path);
        const selected = unwrap(
          await autocompleteMultiselect({
            message: "Accept changed files",
            initialValues: paths,
            required: true,
            options: paths.map((path) => ({ value: path, label: path })),
          }),
        );
        if (selected.length !== paths.length) {
          const omitted = paths.filter((path) => !selected.includes(path));
          const feedback = unwrap(
            await text({ message: "Revision feedback", placeholder: "Explain the desired change" }),
          );
          return {
            accepted: false,
            feedback: `Rejected files: ${omitted.join(", ")}. ${feedback}`,
          };
        }
      }
      const accepted = unwrap(
        await confirm({ message: "Accept this task diff?", initialValue: false }),
      );
      if (accepted) return { accepted: true };
      const feedback = unwrap(
        await text({
          message: "What should be changed?",
          validate: (value) => (!value?.trim() ? "Feedback is required" : undefined),
        }),
      );
      return { accepted: false, feedback: feedback.trim() };
    },
    proposalBlocked(task, proposal) {
      const blocker = proposal.blocker;
      note(
        `${blocker?.reason ?? proposal.summary}\nRequired files: ${blocker?.required_files.join(", ") || "none"}\nDecision: ${blocker?.required_decision ?? "none"}`,
        `${task.id} needs replanning`,
      );
    },
    async approveSensitive(task) {
      note(
        `Permissions: ${task.permissions.join(", ")}\nFiles: ${[...task.files.modify, ...task.files.create].join(", ")}`,
        `${task.id} sensitive operation`,
      );
      return unwrap(
        await confirm({ message: "Confirm these permissions now?", initialValue: false }),
      );
    },
    async approveCommand(task, verification) {
      note(
        `$ ${verification.command.program} ${verification.command.args.join(" ")}\nPurpose: ${verification.purpose}\nEnvironment: sanitized\nTimeout: ${policy.execution.command_timeout_seconds}s`,
        `${task.id} verification`,
      );
      return unwrap(await confirm({ message: "Run this command?", initialValue: false }));
    },
    async retryAfterFailure(task, result) {
      note(formatVerification(result.verification), `${task.id} failed and was rolled back`);
      return unwrap(await confirm({ message: "Generate another proposal?", initialValue: false }));
    },
    async afterTask(task) {
      const options: Array<{
        value: "continue" | "checkpoint" | "rollback";
        label: string;
        hint?: string;
      }> = [
        { value: "continue", label: "Continue" },
        { value: "rollback", label: "Roll back task", hint: "generate another proposal" },
      ];
      if (policy.execution.allow_git_checkpoints) {
        options.splice(1, 0, { value: "checkpoint", label: "Create Git checkpoint" });
      }
      return unwrap(await select({ message: `${task.id} verified`, options }));
    },
    async finalReview(journal, revisableTaskIds) {
      note(`${finalSummary(journal)}\n\n${await workingDiff(root)}`, "Final acceptance");
      const action = unwrap(
        await select({
          message: "Accept implementation?",
          options: [
            { value: "accept", label: "Accept implementation" },
            {
              value: "revise",
              label: "Revise a task",
              disabled: revisableTaskIds.length === 0,
              hint:
                revisableTaskIds.length === 0 ? "no reversible tasks in this session" : undefined,
            },
          ],
        }),
      );
      if (action === "accept") return { accepted: true };
      const taskId = unwrap(
        await select({
          message: "Task to revise",
          options: revisableTaskIds.map((id) => ({ value: id, label: id })),
        }),
      );
      const feedback = unwrap(
        await text({
          message: "What should be changed?",
          validate: (value) => (!value?.trim() ? "Feedback is required" : undefined),
        }),
      );
      return { accepted: false, taskId, feedback: feedback.trim() };
    },
    async resumeExisting(journal) {
      note(
        `${journal.tasks.length} recorded tasks; status: ${journal.status}`,
        "Previous execution",
      );
      return unwrap(
        await confirm({ message: "Resume it after validating file hashes?", initialValue: true }),
      );
    },
    taskCompleted(result) {
      note(formatVerification(result.verification), `${result.task_id} completed`);
    },
  };
}

function unwrap<T>(value: T | symbol): T {
  if (!isCancel(value)) return value as T;
  cancel("Execution cancelled");
  process.exit(0);
}
