import {
  autocompleteMultiselect,
  cancel,
  confirm,
  isCancel,
  note,
  select,
  text,
} from "@clack/prompts";
import { phrase } from "../cli/ui";
import type { Policy } from "../policy/schemas";
import type { Task } from "../tasks/schemas";
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
  note(
    contractSummary(feature, tasks, policy),
    phrase({ en: "Implementation contract", ru: "Контракт реализации" }),
  );
  if (
    !unwrap(
      await confirm({
        message: phrase({ en: "Start implementation?", ru: "Начать реализацию?" }),
        initialValue: false,
      }),
    )
  )
    return null;
  const mode = unwrap(
    await select({
      message: phrase({ en: "Approval mode", ru: "Режим подтверждений" }),
      initialValue: policy.execution.default_approval_mode,
      options: [
        {
          value: "strict",
          label: phrase({ en: "Strict", ru: "Строгий" }),
          hint: phrase({
            en: "approve files and every command",
            ru: "подтверждать файлы и команды",
          }),
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
          message: phrase({
            en: `${task.id} approved write scope`,
            ru: `${task.id}: разрешённые файлы`,
          }),
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
      note(
        phrase({
          en: "Scope changed. Revise the accepted plan before implementation.",
          ru: "Область изменена. Исправьте принятый план до реализации.",
        }),
        phrase({ en: "Execution blocked", ru: "Реализация остановлена" }),
      );
      return false;
    },
    async review(task, proposal, diff) {
      console.log(`\nTask ${task.id}: ${task.title}\n${traceability(proposal)}\n${diff}\n`);
      if (mode === "strict") {
        const paths = proposal.changes.map((change) => change.path);
        const selected = unwrap(
          await autocompleteMultiselect({
            message: phrase({ en: "Accept changed files", ru: "Принять изменённые файлы" }),
            initialValues: paths,
            required: true,
            options: paths.map((path) => ({ value: path, label: path })),
          }),
        );
        if (selected.length !== paths.length) {
          const omitted = paths.filter((path) => !selected.includes(path));
          const feedback = unwrap(
            await text({
              message: phrase({ en: "Revision feedback", ru: "Комментарий к исправлению" }),
              placeholder: phrase({
                en: "Explain the desired change",
                ru: "Опишите желаемое изменение",
              }),
            }),
          );
          return {
            accepted: false,
            feedback: `Rejected files: ${omitted.join(", ")}. ${feedback}`,
          };
        }
      }
      const accepted = unwrap(
        await confirm({
          message: phrase({ en: "Accept this task diff?", ru: "Принять изменения задачи?" }),
          initialValue: false,
        }),
      );
      if (accepted) return { accepted: true };
      const feedback = unwrap(
        await text({
          message: phrase({ en: "What should be changed?", ru: "Что нужно изменить?" }),
          validate: (value) =>
            !value?.trim()
              ? phrase({ en: "Feedback is required", ru: "Нужно описать изменения" })
              : undefined,
        }),
      );
      return { accepted: false, feedback: feedback.trim() };
    },
    proposalBlocked(task, proposal) {
      const blocker = proposal.blocker;
      note(
        `${blocker?.reason ?? proposal.summary}\nRequired files: ${blocker?.required_files.join(", ") || "none"}\nDecision: ${blocker?.required_decision ?? "none"}`,
        phrase({ en: `${task.id} needs replanning`, ru: `${task.id} требует нового плана` }),
      );
    },
    async approveSensitive(task) {
      note(
        `Permissions: ${task.permissions.join(", ")}\nFiles: ${[...task.files.modify, ...task.files.create].join(", ")}`,
        phrase({
          en: `${task.id} sensitive operation`,
          ru: `${task.id}: чувствительная операция`,
        }),
      );
      return unwrap(
        await confirm({
          message: phrase({
            en: "Confirm these permissions now?",
            ru: "Подтвердить эти разрешения?",
          }),
          initialValue: false,
        }),
      );
    },
    async approveCommand(task, verification) {
      note(
        `$ ${verification.command.program} ${verification.command.args.join(" ")}\nPurpose: ${verification.purpose}\nEnvironment: sanitized\nTimeout: ${policy.execution.command_timeout_seconds}s`,
        `${task.id} verification`,
      );
      return unwrap(
        await confirm({
          message: phrase({ en: "Run this command?", ru: "Запустить эту команду?" }),
          initialValue: false,
        }),
      );
    },
    async retryAfterFailure(task, result) {
      note(formatVerification(result.verification), `${task.id} failed and was rolled back`);
      return unwrap(
        await confirm({
          message: phrase({ en: "Generate another proposal?", ru: "Подготовить другой вариант?" }),
          initialValue: false,
        }),
      );
    },
    async afterTask(task) {
      const options: Array<{
        value: "continue" | "checkpoint" | "rollback";
        label: string;
        hint?: string;
      }> = [
        { value: "continue", label: phrase({ en: "Continue", ru: "Продолжить" }) },
        {
          value: "rollback",
          label: phrase({ en: "Roll back task", ru: "Откатить задачу" }),
          hint: phrase({ en: "generate another proposal", ru: "подготовить другой вариант" }),
        },
      ];
      if (policy.execution.allow_git_checkpoints) {
        options.splice(1, 0, {
          value: "checkpoint",
          label: phrase({ en: "Create Git checkpoint", ru: "Создать Git checkpoint" }),
        });
      }
      return unwrap(await select({ message: `${task.id} verified`, options }));
    },
    async finalReview(journal, revisableTaskIds) {
      note(
        `${finalSummary(journal)}\n\n${await workingDiff(root)}`,
        phrase({ en: "Final acceptance", ru: "Финальная приёмка" }),
      );
      const action = unwrap(
        await select({
          message: phrase({ en: "Accept implementation?", ru: "Принять реализацию?" }),
          options: [
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
        }),
      );
      if (action === "accept") return { accepted: true };
      const taskId = unwrap(
        await select({
          message: phrase({ en: "Task to revise", ru: "Задача для исправления" }),
          options: revisableTaskIds.map((id) => ({ value: id, label: id })),
        }),
      );
      const feedback = unwrap(
        await text({
          message: phrase({ en: "What should be changed?", ru: "Что нужно изменить?" }),
          validate: (value) =>
            !value?.trim()
              ? phrase({ en: "Feedback is required", ru: "Нужно описать изменения" })
              : undefined,
        }),
      );
      return { accepted: false, taskId, feedback: feedback.trim() };
    },
    async resumeExisting(journal) {
      note(
        phrase({
          en: `${journal.tasks.length} recorded tasks; status: ${journal.status}`,
          ru: `Сохранено задач: ${journal.tasks.length}; статус: ${journal.status}`,
        }),
        phrase({ en: "Previous execution", ru: "Предыдущий запуск" }),
      );
      return unwrap(
        await confirm({
          message: phrase({
            en: "Resume after validating completed file hashes?",
            ru: "Продолжить после проверки хэшей завершённых файлов?",
          }),
          initialValue: true,
        }),
      );
    },
    taskCompleted(result) {
      note(formatVerification(result.verification), `${result.task_id} completed`);
    },
  };
}

function unwrap<T>(value: T | symbol): T {
  if (!isCancel(value)) return value as T;
  cancel(phrase({ en: "Execution cancelled", ru: "Реализация отменена" }));
  process.exit(0);
}
