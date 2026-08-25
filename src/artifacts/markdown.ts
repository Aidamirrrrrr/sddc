import type { ImplementationPlan } from "../planning/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import { detectLanguage, type ProseLanguage, specificationLanguage } from "../spec/language";
import type { Spec } from "../spec/schemas";
import type { TaskList } from "../tasks/schemas";

/**
 * Structure follows content. The model writes an artifact's prose in the language of the request, so
 * rendering Russian requirements under English headings would make the document read as half
 * translated. Each renderer infers the language from the artifact it is given.
 */
const LABELS = {
  English: {
    requirements: "Requirements",
    requirement: "Requirement",
    goal: "Goal",
    acceptance: "Acceptance",
    criterion: "Acceptance criterion",
    verifies: "Verifies",
    issues: "Known issues",
    kind: "Kind",
    affects: "Affects",
    issue: "Issue",
    decisions: "Open decisions",
    status: "Status",
    plan: "Technical plan",
    approach: "Approach",
    serves: "Serves",
    files: "Files",
    contracts: "Contracts",
    name: "Name",
    change: "Change",
    surface: "Surface",
    dataModel: "Data model",
    entity: "Entity",
    fields: "Fields",
    implementationDecisions: "Implementation decisions",
    decision: "Decision",
    evidence: "Evidence",
    taskGraph: "Task graph",
    wave: "Wave",
    covers: "Covers",
    after: "After",
    reads: "Reads",
    modifies: "Modifies",
    creates: "Creates",
    permissions: "Permissions",
    none: "none",
    doneWhen: "Done when",
    risks: "Risks",
    projectMap: "Project map",
    relevantFiles: "Relevant files",
    path: "Path",
    purpose: "Purpose",
    symbols: "Symbols",
    conventions: "Conventions",
    tests: "Tests",
    constraints: "Constraints",
    finding: "Finding",
    unknown: "Still unknown",
    quickstart: "Quickstart",
    walkthrough: "Acceptance walkthrough",
    coveredBy: "Covered by",
    nothing: "**nothing**",
    fullVerification: "Full verification",
    runInOrder: "Run in dependency order:",
    ready: "ready",
    needs_clarification: "needs clarification",
    needs_decomposition: "needs decomposition",
  },
  Russian: {
    requirements: "Требования",
    requirement: "Требование",
    goal: "Цель",
    acceptance: "Критерии приёмки",
    criterion: "Критерий приёмки",
    verifies: "Проверяет",
    issues: "Известные проблемы",
    kind: "Тип",
    affects: "Затрагивает",
    issue: "Проблема",
    decisions: "Открытые решения",
    status: "Статус",
    plan: "Технический план",
    approach: "Подход",
    serves: "Покрывает",
    files: "Файлы",
    contracts: "Контракты",
    name: "Имя",
    change: "Изменение",
    surface: "Интерфейс",
    dataModel: "Модель данных",
    entity: "Сущность",
    fields: "Поля",
    implementationDecisions: "Решения реализации",
    decision: "Решение",
    evidence: "Источник",
    taskGraph: "Граф задач",
    wave: "Волна",
    covers: "Покрывает",
    after: "После",
    reads: "Читает",
    modifies: "Изменяет",
    creates: "Создаёт",
    permissions: "Разрешения",
    none: "нет",
    doneWhen: "Готово, когда",
    risks: "Риски",
    projectMap: "Карта проекта",
    relevantFiles: "Связанные файлы",
    path: "Путь",
    purpose: "Назначение",
    symbols: "Символы",
    conventions: "Соглашения",
    tests: "Тесты",
    constraints: "Ограничения",
    finding: "Вывод",
    unknown: "Что пока неизвестно",
    quickstart: "Быстрая проверка",
    walkthrough: "Прохождение приёмки",
    coveredBy: "Покрыто задачами",
    nothing: "**ничем**",
    fullVerification: "Полная проверка",
    runInOrder: "Запускать в порядке зависимостей:",
    ready: "готово",
    needs_clarification: "нужны уточнения",
    needs_decomposition: "нужна декомпозиция",
  },
  // No `as const`: the keys must match across languages, but the values are just strings.
} satisfies Record<ProseLanguage, Record<string, string>>;

type Labels = (typeof LABELS)["English"];

/**
 * The reviewable face of an artifact.
 *
 * YAML stays the machine format — it is what the pipeline parses and validates. But an artifact is
 * also the thing a person is asked to approve, and a YAML diff is a poor place to do that. These
 * renderers are one-way on purpose: nothing reads the Markdown back, so it can never disagree with
 * the YAML about what was accepted.
 */
export function specMarkdown(spec: Spec): string {
  const t = LABELS[specificationLanguage(spec)];
  return document([
    heading(1, `${t.requirements} · ${spec.feature}`),
    status(t, spec.status),
    heading(2, t.goal),
    spec.goal,
    table(
      ["ID", t.requirement],
      spec.requirements.map((item) => [item.id, item.statement]),
      t.requirements,
    ),
    table(
      ["ID", t.verifies, t.criterion],
      spec.acceptance.map((item) => [item.id, code(item.verifies), item.statement]),
      t.acceptance,
    ),
    table(
      ["ID", t.kind, t.affects, t.issue],
      spec.issues.map((item) => [item.id, item.kind, code(item.affects), item.statement]),
      t.issues,
    ),
    questions(t, spec.questions),
  ]);
}

export function planMarkdown(plan: ImplementationPlan): string {
  const t = LABELS[detectLanguage(plan.summary, ...plan.approach.map((step) => step.statement))];
  return document([
    heading(1, `${t.plan} · ${plan.feature}`),
    status(t, plan.status),
    plan.summary,
    heading(2, t.approach),
    list(
      plan.approach.map((step) =>
        [
          `**${step.id}.** ${step.statement}`,
          step.requirements.length ? `${t.serves}: ${code(step.requirements)}` : "",
          step.touches.length ? `${t.files}: ${code(step.touches)}` : "",
        ]
          .filter(Boolean)
          .join("  \n  "),
      ),
    ),
    table(
      [t.kind, t.name, t.change, t.surface],
      plan.contracts.map((item) => [item.kind, item.name, item.change, item.surface]),
      t.contracts,
    ),
    table(
      [t.entity, t.change, t.fields],
      plan.data_model.map((item) => [item.entity, item.change, code(item.fields)]),
      t.dataModel,
    ),
    table(
      [t.decision, t.evidence],
      plan.decisions.map((item) => [item.statement, code(item.evidence)]),
      t.implementationDecisions,
    ),
    questions(t, plan.questions),
  ]);
}

export function taskMarkdown(taskList: TaskList): string {
  const t = LABELS[detectLanguage(taskList.summary, ...taskList.tasks.map((task) => task.title))];
  const waves = [...new Set(taskList.tasks.map((task) => task.wave))].sort((a, b) => a - b);
  return document([
    heading(1, `${t.taskGraph} · ${taskList.feature}`),
    status(t, taskList.status),
    taskList.summary,
    ...waves.flatMap((wave) => [
      heading(2, `${t.wave} ${wave}`),
      ...taskList.tasks
        .filter((task) => task.wave === wave)
        .map((task) =>
          document([
            heading(3, `${task.id}${task.parallel ? " `[P]`" : ""} — ${task.title}`),
            task.goal,
            definitions([
              [t.covers, code([...task.requirements, ...task.acceptance])],
              [t.after, task.depends_on.length ? code(task.depends_on) : "—"],
              [t.reads, task.files.read.length ? code(task.files.read) : "—"],
              [t.modifies, task.files.modify.length ? code(task.files.modify) : "—"],
              [t.creates, task.files.create.length ? code(task.files.create) : "—"],
              [t.permissions, task.permissions.length ? code(task.permissions) : t.none],
            ]),
            fence(
              task.verification
                .map((item) => `$ ${item.command.program} ${item.command.args.join(" ")}`)
                .join("\n"),
            ),
            task.done_when.length ? `**${t.doneWhen}:** ${task.done_when.join("; ")}` : "",
            task.risks.length ? `**${t.risks}:** ${task.risks.join("; ")}` : "",
          ]),
        ),
    ]),
    questions(t, taskList.questions),
  ]);
}

/**
 * The acceptance trail: how someone checks the feature actually works.
 *
 * SDD calls this quickstart. It is derived, not generated — every part already exists in the accepted
 * artifacts, so asking a model for it would only add a way for it to disagree with them.
 */
export function quickstartMarkdown(spec: Spec, taskList: TaskList): string {
  const t = LABELS[specificationLanguage(spec)];
  const covering = (id: string) => taskList.tasks.filter((task) => task.acceptance.includes(id));
  const commands = new Set<string>();
  for (const task of [...taskList.tasks].sort((a, b) => a.wave - b.wave)) {
    for (const item of task.verification) {
      commands.add(`${item.command.program} ${item.command.args.join(" ")}`.trim());
    }
  }

  return document([
    heading(1, `${t.quickstart} · ${spec.feature}`),
    spec.goal,
    heading(2, t.walkthrough),
    ...spec.acceptance.map((criterion) => {
      const tasks = covering(criterion.id);
      const proofs = tasks.flatMap((task) =>
        task.verification.map((item) =>
          `${item.command.program} ${item.command.args.join(" ")}`.trim(),
        ),
      );
      return document([
        heading(3, `${criterion.id} — ${criterion.statement}`),
        definitions([
          [t.verifies, code(criterion.verifies)],
          [t.coveredBy, tasks.length ? code(tasks.map((task) => task.id)) : t.nothing],
        ]),
        proofs.length ? fence([...new Set(proofs)].map((line) => `$ ${line}`).join("\n")) : "",
      ]);
    }),
    heading(2, t.fullVerification),
    t.runInOrder,
    fence([...commands].map((line) => `$ ${line}`).join("\n")),
  ]);
}

export function discoveryMarkdown(discovery: RepositoryDiscovery): string {
  const t = LABELS[detectLanguage(discovery.summary)];
  return document([
    heading(1, t.projectMap),
    discovery.summary,
    table(
      [t.path, t.purpose, t.symbols],
      discovery.relevant_files.map((item) => [item.path, item.purpose, code(item.symbols)]),
      t.relevantFiles,
    ),
    evidenceTable(t, t.conventions, discovery.conventions),
    evidenceTable(t, t.tests, discovery.testing),
    evidenceTable(t, t.constraints, discovery.constraints),
    discovery.unknowns.length ? document([heading(2, t.unknown), list(discovery.unknowns)]) : "",
  ]);
}

/* ---------- building blocks ---------- */

function document(parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join("\n\n");
}

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function status(t: Labels, value: string): string {
  // An untranslated status would leave one English word in an otherwise Russian document.
  const translated = (t as Record<string, string | undefined>)[value];
  return `*${t.status}: ${translated ?? value.replace(/_/g, " ")}*`;
}

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function code(values: string[]): string {
  return values.length === 0 ? "—" : values.map((value) => `\`${value}\``).join(", ");
}

function fence(body: string): string {
  return body.trim().length === 0 ? "" : ["```sh", body, "```"].join("\n");
}

function definitions(rows: Array<[string, string]>): string {
  return rows
    .filter(([, value]) => value && value !== "—")
    .map(([label, value]) => `- **${label}:** ${value}`)
    .join("\n");
}

function table(headers: string[], rows: string[][], title: string): string {
  if (rows.length === 0) return "";
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
  return document([
    heading(2, title),
    [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...body].join(
      "\n",
    ),
  ]);
}

function evidenceTable(
  t: Labels,
  title: string,
  items: Array<{ statement: string; evidence: string[] }>,
): string {
  return table(
    [t.finding, t.evidence],
    items.map((item) => [item.statement, code(item.evidence)]),
    title,
  );
}

function questions(
  t: Labels,
  items: Array<{ id: string; question: string; reason: string }>,
): string {
  if (items.length === 0) return "";
  return document([
    heading(2, t.decisions),
    list(items.map((item) => `**${item.id}.** ${item.question}  \n  ${item.reason}`)),
  ]);
}

/** A pipe inside a cell would otherwise split it into two columns. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}
