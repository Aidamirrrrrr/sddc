import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { ImplementationPlan, PlanReview } from "./schemas";

export function normalizePlan(plan: ImplementationPlan, feature: string): ImplementationPlan {
  const ids = new Map(plan.tasks.map((task, index) => [task.id, `T${index + 1}`]));
  return {
    ...plan,
    feature,
    tasks: plan.tasks.map((task, index) => ({
      ...task,
      id: `T${index + 1}`,
      depends_on: unique(task.depends_on.map((id) => ids.get(id) ?? id)),
      permissions: unique(task.permissions),
      requirements: unique(task.requirements),
      acceptance: unique(task.acceptance),
      files: {
        read: unique(task.files.read),
        modify: unique(task.files.modify),
        create: unique(task.files.create),
      },
    })),
    questions: plan.questions.map((question, index) => ({
      ...question,
      id: `Q${index + 1}`,
      blocking: true,
    })),
  };
}

export function validatePlan(
  plan: ImplementationPlan,
  spec: Spec,
  discovery: RepositoryDiscovery,
  repositoryPaths: string[] = discovery.context.files,
): void {
  if (plan.feature !== spec.feature) throw new Error("Plan feature does not match specification");
  if (plan.status === "needs_clarification") {
    if (plan.questions.length === 0) throw new Error("Clarification plan has no questions");
    if (plan.tasks.length === 0) return;
  } else {
    if (plan.questions.length > 0) throw new Error("Ready plan must not contain questions");
    if (plan.tasks.length === 0) throw new Error("Ready plan has no tasks");
  }

  const requirements = new Set(spec.requirements.map((item) => item.id));
  const acceptance = new Set(spec.acceptance.map((item) => item.id));
  const coveredRequirements = new Set<string>();
  const coveredAcceptance = new Set<string>();
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const approvedFiles = new Set(discovery.context.files);
  const existingFiles = new Set(repositoryPaths);
  const tasksById = new Map(plan.tasks.map((task) => [task.id, task]));

  for (const decision of plan.decisions) {
    const unsupported = decision.evidence.find((path) => !approvedFiles.has(path));
    if (unsupported)
      throw new Error(`Plan decision references unapproved evidence: ${unsupported}`);
  }

  for (const task of plan.tasks) {
    validateReferences(task.requirements, requirements, "requirement", task.id);
    validateReferences(task.acceptance, acceptance, "acceptance criterion", task.id);
    for (const id of task.requirements) coveredRequirements.add(id);
    for (const id of task.acceptance) coveredAcceptance.add(id);
    validateReferences(task.depends_on, taskIds, "task dependency", task.id);
    if (task.depends_on.includes(task.id)) throw new Error(`${task.id} depends on itself`);
    for (const path of [...task.files.read, ...task.files.modify, ...task.files.create]) {
      if (!isSafeProjectPath(path)) throw new Error(`${task.id} contains unsafe path: ${path}`);
    }
    for (const path of [...task.files.read, ...task.files.modify]) {
      if (!approvedFiles.has(path))
        throw new Error(`${task.id} references unapproved file: ${path}`);
    }
    const existingCreate = task.files.create.find((path) => existingFiles.has(path));
    if (existingCreate)
      throw new Error(`${task.id} lists existing file as create: ${existingCreate}`);
    const create = new Set(task.files.create);
    const overlap = task.files.modify.find((path) => create.has(path));
    if (overlap) throw new Error(`${task.id} both modifies and creates ${overlap}`);
    for (const verification of task.verification) {
      if (!verification.command.program.trim()) {
        throw new Error(`${task.id} has an empty verification program`);
      }
      const available = availableFiles(task.id, tasksById, existingFiles);
      const missing = verification.command.args.find(
        (argument) => looksLikeProjectFile(argument) && !available.has(argument),
      );
      if (missing)
        throw new Error(`${task.id} verification references unavailable file: ${missing}`);
    }
  }

  if (plan.status === "ready") {
    assertCoverage(requirements, coveredRequirements, "requirements");
    assertCoverage(acceptance, coveredAcceptance, "acceptance criteria");
  }
  assertAcyclic(plan);
}

export function validatePlanReview(review: PlanReview): void {
  const passed = new Set(review.checks.filter((check) => check.passed).map((check) => check.id));
  const missing = Array.from({ length: 10 }, (_, index) => `C${index + 1}`).filter(
    (id) => !passed.has(id),
  );
  if (missing.length > 0) throw new Error(`Plan review failed checks: ${missing.join(", ")}`);
}

function assertAcyclic(plan: ImplementationPlan): void {
  const dependencies = new Map(plan.tasks.map((task) => [task.id, task.depends_on]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Task dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of dependencies.keys()) visit(id);
}

function validateReferences(
  values: string[],
  allowed: Set<string>,
  label: string,
  taskId: string,
): void {
  const invalid = values.find((value) => !allowed.has(value));
  if (invalid) throw new Error(`${taskId} references unknown ${label}: ${invalid}`);
}

function assertCoverage(expected: Set<string>, actual: Set<string>, label: string): void {
  const missing = [...expected].filter((id) => !actual.has(id));
  if (missing.length > 0) throw new Error(`Plan does not cover ${label}: ${missing.join(", ")}`);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function availableFiles(
  taskId: string,
  tasks: Map<string, ImplementationPlan["tasks"][number]>,
  existing: Set<string>,
  visited = new Set<string>(),
): Set<string> {
  const available = new Set(existing);
  if (visited.has(taskId)) return available;
  visited.add(taskId);
  const task = tasks.get(taskId);
  if (!task) return available;
  for (const path of task.files.create) available.add(path);
  for (const dependency of task.depends_on) {
    for (const path of availableFiles(dependency, tasks, existing, visited)) available.add(path);
  }
  return available;
}

function looksLikeProjectFile(argument: string): boolean {
  if (argument.startsWith("-") || argument.includes("://")) return false;
  return (
    argument.includes("/") ||
    /\.(?:cjs|css|go|html|java|js|json|jsx|kt|md|mjs|py|rs|toml|ts|tsx|yaml|yml)$/i.test(argument)
  );
}

function isSafeProjectPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  const lower = parts.at(-1)?.toLocaleLowerCase() ?? "";
  if (parts.includes(".git") || parts.includes(".specs")) return false;
  if (lower === ".env" || (lower.startsWith(".env.") && lower !== ".env.example")) return false;
  return !lower.endsWith(".pem") && !lower.endsWith(".key");
}
