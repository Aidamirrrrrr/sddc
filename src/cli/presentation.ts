import type { ImplementationPlan } from "../planning/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import { phrase } from "./ui";

export function specSummary(spec: Spec): string {
  return [
    spec.goal,
    "",
    phrase({
      en: `${spec.requirements.length} requirements · ${spec.acceptance.length} acceptance checks`,
      ru: `${spec.requirements.length} требований · ${spec.acceptance.length} проверок приёмки`,
    }),
    ...spec.requirements.slice(0, 6).map((item) => `  ${item.id}  ${item.statement}`),
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

export function discoverySummary(discovery: RepositoryDiscovery): string {
  const tests = discovery.testing.length;
  const unknowns = discovery.unknowns.length;
  return [
    discovery.summary,
    "",
    phrase({
      en: `${discovery.relevant_files.length} relevant files · ${tests} testing findings · ${unknowns} unknowns`,
      ru: `${discovery.relevant_files.length} связанных файлов · сведений о тестах: ${tests} · неизвестных фактов: ${unknowns}`,
    }),
    ...discovery.relevant_files.slice(0, 8).map((item) => `  ${item.path}`),
  ].join("\n");
}

export function planSummary(plan: ImplementationPlan): string {
  const files = new Set(plan.tasks.flatMap((task) => [...task.files.modify, ...task.files.create]));
  const commands = plan.tasks.reduce((sum, task) => sum + task.verification.length, 0);
  return [
    plan.summary,
    "",
    phrase({
      en: `${plan.tasks.length} tasks · ${files.size} writable files · ${commands} verification commands`,
      ru: `${plan.tasks.length} задач · файлов для изменения: ${files.size} · команд проверки: ${commands}`,
    }),
    ...plan.tasks.map((task) => `  ${task.id}  ${task.title}`),
  ].join("\n");
}
