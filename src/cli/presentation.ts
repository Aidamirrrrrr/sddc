import type { ImplementationPlan } from "../planning/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { TaskList } from "../tasks/schemas";
import { accent, muted, phrase } from "./ui";

export function specSummary(spec: Spec): string {
  return [
    spec.goal,
    "",
    muted(
      phrase({
        en: `${spec.requirements.length} requirements · ${spec.acceptance.length} acceptance checks`,
        ru: `${spec.requirements.length} требований · ${spec.acceptance.length} проверок приёмки`,
      }),
    ),
    ...spec.requirements.slice(0, 6).map((item) => `  ${accent(item.id)}  ${item.statement}`),
    ...(spec.requirements.length > 6
      ? [
          phrase({
            en: "  … Open the full document to see more",
            ru: "  … Остальное в полном документе",
          }),
        ]
      : []),
  ].join("\n");
}

export function specDocument(spec: Spec): string {
  return sections([
    [phrase({ en: "Goal", ru: "Цель" }), [spec.goal]],
    [
      phrase({ en: "Requirements", ru: "Требования" }),
      spec.requirements.map((item) => `${item.id}. ${item.statement}`),
    ],
    [
      phrase({ en: "How the result will be checked", ru: "Как будет проверен результат" }),
      spec.acceptance.map((item) => `${item.id}. ${item.statement} (${item.verifies.join(", ")})`),
    ],
    [
      phrase({ en: "Known issues", ru: "Известные проблемы" }),
      spec.issues.map((item) => `${item.id}. ${item.statement}`),
    ],
    [
      phrase({ en: "Decisions needed", ru: "Нужны решения" }),
      spec.questions.map((item) => `${item.id}. ${item.question}\n  ${item.reason}`),
    ],
  ]);
}

export function discoverySummary(discovery: RepositoryDiscovery): string {
  const tests = discovery.testing.length;
  const unknowns = discovery.unknowns.length;
  return [
    discovery.summary,
    "",
    muted(
      phrase({
        en: `${discovery.relevant_files.length} relevant files · ${tests} testing findings · ${unknowns} unknowns`,
        ru: `${discovery.relevant_files.length} связанных файлов · сведений о тестах: ${tests} · неизвестных фактов: ${unknowns}`,
      }),
    ),
    ...discovery.relevant_files.slice(0, 8).map((item) => `  ${item.path}`),
  ].join("\n");
}

export function projectMapDocument(discovery: RepositoryDiscovery): string {
  return sections([
    [phrase({ en: "Summary", ru: "Кратко" }), [discovery.summary]],
    [
      phrase({ en: "Relevant code", ru: "Связанный код" }),
      discovery.relevant_files.map((item) =>
        [item.path, `  ${item.purpose}`, item.symbols.length ? `  ${item.symbols.join(", ")}` : ""]
          .filter(Boolean)
          .join("\n"),
      ),
    ],
    [
      phrase({ en: "Existing conventions", ru: "Существующие соглашения" }),
      discovery.conventions.map((item) => evidenceLine(item.statement, item.evidence)),
    ],
    [
      phrase({ en: "Tests", ru: "Тесты" }),
      discovery.testing.map((item) => evidenceLine(item.statement, item.evidence)),
    ],
    [
      phrase({ en: "Constraints", ru: "Ограничения" }),
      discovery.constraints.map((item) => evidenceLine(item.statement, item.evidence)),
    ],
    [phrase({ en: "Still unknown", ru: "Что пока неизвестно" }), discovery.unknowns],
  ]);
}

export function planSummary(plan: ImplementationPlan): string {
  const touched = new Set(plan.approach.flatMap((step) => step.touches));
  return [
    plan.summary,
    "",
    muted(
      phrase({
        en: `${plan.approach.length} approach steps · ${plan.contracts.length} contracts · ${touched.size} files in scope`,
        ru: `${plan.approach.length} шагов подхода · контрактов: ${plan.contracts.length} · файлов в области: ${touched.size}`,
      }),
    ),
    ...plan.approach.map((step) => `  ${accent(step.id)}  ${step.statement}`),
  ].join("\n");
}

export function planDocument(plan: ImplementationPlan): string {
  return sections([
    [phrase({ en: "Summary", ru: "Кратко" }), [plan.summary]],
    [
      phrase({ en: "Technical approach", ru: "Технический подход" }),
      plan.approach.map((step) =>
        [
          `${step.id}. ${step.statement}`,
          step.requirements.length
            ? `  ${phrase({ en: "Serves", ru: "Покрывает" })}: ${step.requirements.join(", ")}`
            : "",
          step.touches.length
            ? `  ${phrase({ en: "Files", ru: "Файлы" })}: ${step.touches.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ],
    [
      phrase({ en: "Contracts", ru: "Контракты" }),
      plan.contracts.map((item) => `${item.kind} ${item.name} (${item.change})\n  ${item.surface}`),
    ],
    [
      phrase({ en: "Data model", ru: "Модель данных" }),
      plan.data_model.map((item) => `${item.entity} (${item.change})\n  ${item.fields.join(", ")}`),
    ],
    [
      phrase({ en: "Implementation decisions", ru: "Решения реализации" }),
      plan.decisions.map((item) => evidenceLine(item.statement, item.evidence)),
    ],
  ]);
}

export function taskSummary(list: TaskList): string {
  const files = new Set(list.tasks.flatMap((task) => [...task.files.modify, ...task.files.create]));
  const commands = list.tasks.reduce((sum, task) => sum + task.verification.length, 0);
  const waves = new Set(list.tasks.map((task) => task.wave));
  return [
    list.summary,
    "",
    muted(
      phrase({
        en: `${list.tasks.length} tasks in ${waves.size} waves · ${files.size} writable files · ${commands} verification commands`,
        ru: `${list.tasks.length} задач в ${waves.size} волнах · файлов для изменения: ${files.size} · команд проверки: ${commands}`,
      }),
    ),
    ...list.tasks.map(
      (task) => `  ${accent(task.id)}${task.parallel ? " [P]" : "    "}  ${task.title}`,
    ),
  ].join("\n");
}

export function taskDocument(list: TaskList): string {
  const waves = [...new Set(list.tasks.map((task) => task.wave))].sort((a, b) => a - b);
  return sections([
    [phrase({ en: "Summary", ru: "Кратко" }), [list.summary]],
    ...waves.map((wave): [string, string[]] => [
      phrase({ en: `Wave ${wave}`, ru: `Волна ${wave}` }),
      list.tasks
        .filter((task) => task.wave === wave)
        .map((task) => {
          const writes = [...task.files.modify, ...task.files.create];
          const removals = task.files.delete;
          const commands = task.verification.map(
            (item) => `$ ${item.command.program} ${item.command.args.join(" ")}`,
          );
          return [
            `${task.id}${task.parallel ? " [P]" : ""}. ${task.title}`,
            `  ${task.goal}`,
            `  ${phrase({ en: "Covers", ru: "Покрывает" })}: ${[...task.requirements, ...task.acceptance].join(", ")}`,
            task.depends_on.length
              ? `  ${phrase({ en: "After", ru: "После" })}: ${task.depends_on.join(", ")}`
              : "",
            writes.length ? `  ${phrase({ en: "Files", ru: "Файлы" })}: ${writes.join(", ")}` : "",
            removals.length
              ? `  ${phrase({ en: "Removes", ru: "Удаляет" })}: ${removals.join(", ")}`
              : "",
            commands.length
              ? `  ${phrase({ en: "Checks", ru: "Проверки" })}: ${commands.join("; ")}`
              : "",
            task.risks.length
              ? `  ${phrase({ en: "Risks", ru: "Риски" })}: ${task.risks.join("; ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }),
    ]),
  ]);
}

function sections(items: Array<[string, string[]]>): string {
  return items
    .filter(([, lines]) => lines.length > 0)
    .map(([title, lines]) => `${accent(title)}\n${lines.map((line) => `  ${line}`).join("\n")}`)
    .join("\n\n");
}

function evidenceLine(statement: string, evidence: string[]): string {
  return `${statement}\n  ${phrase({ en: "Source", ru: "Источник" })}: ${evidence.join(", ")}`;
}
