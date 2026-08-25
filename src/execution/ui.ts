import { phrase } from "../cli/ui";
import type { Policy } from "../policy/schemas";
import type { Task } from "../tasks/schemas";
import { driver } from "../ui/driver";
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
  feature: string,
  tasks: Task[],
  policy: Policy,
): Promise<{ mode: ExecutionJournal["mode"]; hooks: ExecutionHooks } | null> {
  driver().document(
    phrase({ en: "Implementation contract", ru: "Контракт реализации" }),
    contractSummary(feature, tasks, policy),
  );
  const start = await driver().confirm(
    phrase({ en: "Start implementation?", ru: "Начать реализацию?" }),
    false,
  );
  if (!start) return null;

  const mode = (await driver().select(
    phrase({ en: "Approval mode", ru: "Режим подтверждений" }),
    [
      {
        value: "strict",
        label: phrase({ en: "Strict", ru: "Строгий" }),
        hint: phrase({ en: "approve files and every command", ru: "подтверждать файлы и команды" }),
      },
      {
        value: "normal",
        label: phrase({ en: "Normal", ru: "Обычный" }),
        hint: phrase({ en: "approve each task diff", ru: "подтверждать diff каждой задачи" }),
      },
      {
        value: "trusted",
        label: phrase({ en: "Trusted", ru: "Доверенный" }),
        hint: phrase({
          en: "automatic diffs; verification still runs",
          ru: "diff принимается автоматически; проверки выполняются",
        }),
      },
    ],
    policy.execution.default_approval_mode,
  )) as ExecutionJournal["mode"];

  return { mode, hooks: createHooks(root, mode, policy) };
}

function createHooks(root: string, mode: ExecutionJournal["mode"], policy: Policy): ExecutionHooks {
  const feedback = async (message: { en: string; ru: string }): Promise<string> =>
    driver().text(phrase(message), {
      required: true,
      requiredMessage: phrase({ en: "Feedback is required", ru: "Нужно описать изменения" }),
    });

  return {
    async approveScope(task) {
      if (mode !== "strict") return true;
      const files = [...task.files.modify, ...task.files.create];
      const selected = await driver().multiselect(
        phrase({ en: `${task.id} approved write scope`, ru: `${task.id}: разрешённые файлы` }),
        files.map((path) => ({
          value: path,
          label: path,
          hint: task.files.create.includes(path) ? "create" : "modify",
        })),
        files,
      );
      if (selected.length === files.length) return true;
      driver().document(
        phrase({ en: "Execution blocked", ru: "Реализация остановлена" }),
        phrase({
          en: "Scope changed. Revise the accepted plan before implementation.",
          ru: "Область изменена. Исправьте принятый план до реализации.",
        }),
      );
      return false;
    },
    async review(task, proposal, diff) {
      driver().document(`${task.id} · ${task.title}`, `${traceability(proposal)}\n\n${diff}`);
      if (mode === "strict") {
        const paths = proposal.changes.map((change) => change.path);
        const selected = await driver().multiselect(
          phrase({ en: "Accept changed files", ru: "Принять изменённые файлы" }),
          paths.map((path) => ({ value: path, label: path })),
          paths,
        );
        if (selected.length !== paths.length) {
          const omitted = paths.filter((path) => !selected.includes(path));
          const note = await feedback({
            en: "Revision feedback",
            ru: "Комментарий к исправлению",
          });
          return { accepted: false, feedback: `Rejected files: ${omitted.join(", ")}. ${note}` };
        }
      }
      const accepted = await driver().confirm(
        phrase({ en: "Accept this task diff?", ru: "Принять изменения задачи?" }),
        false,
      );
      if (accepted) return { accepted: true };
      return {
        accepted: false,
        feedback: await feedback({ en: "What should be changed?", ru: "Что нужно изменить?" }),
      };
    },
    proposalBlocked(task, proposal) {
      const blocker = proposal.blocker;
      driver().document(
        phrase({ en: `${task.id} needs replanning`, ru: `${task.id} требует нового плана` }),
        `${blocker?.reason ?? proposal.summary}\nRequired files: ${blocker?.required_files.join(", ") || "none"}\nDecision: ${blocker?.required_decision ?? "none"}`,
      );
    },
    async approveSensitive(task) {
      driver().document(
        phrase({ en: `${task.id} sensitive operation`, ru: `${task.id}: чувствительная операция` }),
        `Permissions: ${task.permissions.join(", ")}\nFiles: ${[...task.files.modify, ...task.files.create].join(", ")}`,
      );
      return driver().confirm(
        phrase({ en: "Confirm these permissions now?", ru: "Подтвердить эти разрешения?" }),
        false,
      );
    },
    async approveCommand(task, verification) {
      driver().document(
        `${task.id} verification`,
        `$ ${verification.command.program} ${verification.command.args.join(" ")}\nPurpose: ${verification.purpose}\nEnvironment: sanitized\nTimeout: ${policy.execution.command_timeout_seconds}s`,
      );
      return driver().confirm(
        phrase({ en: "Run this command?", ru: "Запустить эту команду?" }),
        false,
      );
    },
    taskProgress(task, turn, verification) {
      const failed = verification.filter((item) => item.exit_code !== 0);
      driver().action(
        phrase({
          en: `${task.id} · attempt ${turn}`,
          ru: `${task.id} · попытка ${turn}`,
        }),
        verification.map(
          (item) =>
            `${item.exit_code === 0 ? "✓" : "✗"} ${item.program} ${item.args.join(" ")}${
              item.timed_out ? " (timed out)" : ""
            }`,
        ),
        failed.length === 0 ? "success" : "warn",
      );
    },
    async retryAfterFailure(task, result) {
      driver().document(
        `${task.id} failed and was rolled back`,
        formatVerification(result.verification),
      );
      return driver().confirm(
        phrase({ en: "Generate another proposal?", ru: "Подготовить другой вариант?" }),
        false,
      );
    },
    async afterTask(task) {
      const options = [
        { value: "continue", label: phrase({ en: "Continue", ru: "Продолжить" }) },
        ...(policy.execution.allow_git_checkpoints
          ? [
              {
                value: "checkpoint",
                label: phrase({ en: "Create Git checkpoint", ru: "Создать Git checkpoint" }),
              },
            ]
          : []),
        {
          value: "rollback",
          label: phrase({ en: "Roll back task", ru: "Откатить задачу" }),
          hint: phrase({ en: "generate another proposal", ru: "подготовить другой вариант" }),
        },
      ];
      return (await driver().select(`${task.id} verified`, options)) as
        | "continue"
        | "checkpoint"
        | "rollback";
    },
    async finalReview(journal, revisableTaskIds) {
      driver().document(
        phrase({ en: "Final acceptance", ru: "Финальная приёмка" }),
        `${finalSummary(journal)}\n\n${await workingDiff(root)}`,
      );
      const action = await driver().select(
        phrase({ en: "Accept implementation?", ru: "Принять реализацию?" }),
        [
          {
            value: "accept",
            label: phrase({ en: "Accept implementation", ru: "Принять реализацию" }),
          },
          {
            value: "revise",
            label: phrase({ en: "Revise a task", ru: "Исправить задачу" }),
            disabled: revisableTaskIds.length === 0,
            hint:
              revisableTaskIds.length === 0
                ? phrase({
                    en: "no reversible tasks in this session",
                    ru: "в этой сессии нет обратимых задач",
                  })
                : undefined,
          },
        ],
      );
      if (action === "accept") return { accepted: true };
      const taskId = await driver().select(
        phrase({ en: "Task to revise", ru: "Задача для исправления" }),
        revisableTaskIds.map((id) => ({ value: id, label: id })),
      );
      return {
        accepted: false,
        taskId,
        feedback: await feedback({ en: "What should be changed?", ru: "Что нужно изменить?" }),
      };
    },
    async resumeExisting(journal) {
      driver().document(
        phrase({ en: "Previous execution", ru: "Предыдущий запуск" }),
        phrase({
          en: `${journal.tasks.length} recorded tasks; status: ${journal.status}`,
          ru: `Сохранено задач: ${journal.tasks.length}; статус: ${journal.status}`,
        }),
      );
      return driver().confirm(
        phrase({
          en: "Resume after validating completed file hashes?",
          ru: "Продолжить после проверки хэшей завершённых файлов?",
        }),
        true,
      );
    },
    taskCompleted(result) {
      // One event to a reader, several to the log: the summary carries the outcome and the files
      // and commands hang off it, so a long run stays scannable without hiding what it did.
      driver().action(
        phrase({
          en: `${result.task_id} completed`,
          ru: `${result.task_id} выполнена`,
        }),
        [
          ...result.changed_files.map((path) => `wrote ${path}`),
          ...result.verification.map(
            (item) => `${item.exit_code === 0 ? "✓" : "✗"} ${item.program} ${item.args.join(" ")}`,
          ),
        ],
        "success",
      );
    },
  };
}
