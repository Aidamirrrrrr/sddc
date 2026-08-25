import type { ImplementationPlan } from "../planning/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { TaskList } from "../tasks/schemas";

/**
 * The reviewable face of an artifact.
 *
 * YAML stays the machine format — it is what the pipeline parses and validates. But an artifact is
 * also the thing a person is asked to approve, and a YAML diff is a poor place to do that. These
 * renderers are one-way on purpose: nothing reads the Markdown back, so it can never disagree with
 * the YAML about what was accepted.
 */
export function specMarkdown(spec: Spec): string {
  return document([
    heading(1, `Requirements · ${spec.feature}`),
    status(spec.status),
    heading(2, "Goal"),
    spec.goal,
    table(
      ["ID", "Requirement"],
      spec.requirements.map((item) => [item.id, item.statement]),
      "Requirements",
    ),
    table(
      ["ID", "Verifies", "Acceptance criterion"],
      spec.acceptance.map((item) => [item.id, code(item.verifies), item.statement]),
      "Acceptance",
    ),
    table(
      ["ID", "Kind", "Affects", "Issue"],
      spec.issues.map((item) => [item.id, item.kind, code(item.affects), item.statement]),
      "Known issues",
    ),
    questions(spec.questions),
  ]);
}

export function planMarkdown(plan: ImplementationPlan): string {
  return document([
    heading(1, `Technical plan · ${plan.feature}`),
    status(plan.status),
    plan.summary,
    heading(2, "Approach"),
    list(
      plan.approach.map((step) =>
        [
          `**${step.id}.** ${step.statement}`,
          step.requirements.length ? `Serves: ${code(step.requirements)}` : "",
          step.touches.length ? `Files: ${code(step.touches)}` : "",
        ]
          .filter(Boolean)
          .join("  \n  "),
      ),
    ),
    table(
      ["Kind", "Name", "Change", "Surface"],
      plan.contracts.map((item) => [item.kind, item.name, item.change, item.surface]),
      "Contracts",
    ),
    table(
      ["Entity", "Change", "Fields"],
      plan.data_model.map((item) => [item.entity, item.change, code(item.fields)]),
      "Data model",
    ),
    table(
      ["Decision", "Evidence"],
      plan.decisions.map((item) => [item.statement, code(item.evidence)]),
      "Implementation decisions",
    ),
    questions(plan.questions),
  ]);
}

export function taskMarkdown(taskList: TaskList): string {
  const waves = [...new Set(taskList.tasks.map((task) => task.wave))].sort((a, b) => a - b);
  return document([
    heading(1, `Task graph · ${taskList.feature}`),
    status(taskList.status),
    taskList.summary,
    ...waves.flatMap((wave) => [
      heading(2, `Wave ${wave}`),
      ...taskList.tasks
        .filter((task) => task.wave === wave)
        .map((task) =>
          document([
            heading(3, `${task.id}${task.parallel ? " `[P]`" : ""} — ${task.title}`),
            task.goal,
            definitions([
              ["Covers", code([...task.requirements, ...task.acceptance])],
              ["After", task.depends_on.length ? code(task.depends_on) : "—"],
              ["Reads", task.files.read.length ? code(task.files.read) : "—"],
              ["Modifies", task.files.modify.length ? code(task.files.modify) : "—"],
              ["Creates", task.files.create.length ? code(task.files.create) : "—"],
              ["Permissions", task.permissions.length ? code(task.permissions) : "none"],
            ]),
            fence(
              task.verification
                .map((item) => `$ ${item.command.program} ${item.command.args.join(" ")}`)
                .join("\n"),
            ),
            task.done_when.length ? `**Done when:** ${task.done_when.join("; ")}` : "",
            task.risks.length ? `**Risks:** ${task.risks.join("; ")}` : "",
          ]),
        ),
    ]),
    questions(taskList.questions),
  ]);
}

export function discoveryMarkdown(discovery: RepositoryDiscovery): string {
  return document([
    heading(1, "Project map"),
    discovery.summary,
    table(
      ["Path", "Purpose", "Symbols"],
      discovery.relevant_files.map((item) => [item.path, item.purpose, code(item.symbols)]),
      "Relevant files",
    ),
    evidenceTable("Conventions", discovery.conventions),
    evidenceTable("Tests", discovery.testing),
    evidenceTable("Constraints", discovery.constraints),
    discovery.unknowns.length
      ? document([heading(2, "Still unknown"), list(discovery.unknowns)])
      : "",
  ]);
}

/* ---------- building blocks ---------- */

function document(parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join("\n\n");
}

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function status(value: string): string {
  return `*Status: ${value.replace(/_/g, " ")}*`;
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
  title: string,
  items: Array<{ statement: string; evidence: string[] }>,
): string {
  return table(
    ["Finding", "Evidence"],
    items.map((item) => [item.statement, code(item.evidence)]),
    title,
  );
}

function questions(items: Array<{ id: string; question: string; reason: string }>): string {
  if (items.length === 0) return "";
  return document([
    heading(2, "Open decisions"),
    list(items.map((item) => `**${item.id}.** ${item.question}  \n  ${item.reason}`)),
  ]);
}

/** A pipe inside a cell would otherwise split it into two columns. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}
