import { isBehaviouralSource, writesOnlyTests } from "../policy/paths";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { Task, TaskList, TaskListDraft, TaskListReview } from "./schemas";

export function normalizeTaskList(draft: TaskListDraft, feature: string): TaskList {
  const ids = new Map(draft.tasks.map((task, index) => [task.id, `T${index + 1}`]));
  const renumbered = draft.tasks.map((task, index) => ({
    ...task,
    id: `T${index + 1}`,
    depends_on: unique(task.depends_on.map((id) => ids.get(id) ?? id)).filter(
      (id) => id !== `T${index + 1}`,
    ),
    permissions: unique(task.permissions),
    requirements: unique(task.requirements),
    acceptance: unique(task.acceptance),
    files: {
      read: unique(task.files.read),
      modify: unique(task.files.modify),
      create: unique(task.files.create),
    },
  }));
  return {
    ...draft,
    feature,
    tasks: assignWaves(renumbered),
    questions: draft.questions.map((question, index) => ({
      ...question,
      id: `Q${index + 1}`,
      blocking: true,
    })),
  };
}

/**
 * Groups tasks into dependency waves. Every task in a wave is independent of the others in it, so
 * the wave is a sound parallelism marker: it is derived from the graph, never claimed by the model.
 */
export function assignWaves(tasks: Omit<Task, "wave" | "parallel">[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depth = new Map<string, number>();
  const visit = (id: string, visiting: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const task = byId.get(id);
    if (!task || visiting.has(id)) return 1;
    visiting.add(id);
    const value = Math.max(1, ...task.depends_on.map((parent) => visit(parent, visiting) + 1));
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  const waves = tasks.map((task) => visit(task.id, new Set()));
  const sizes = new Map<number, number>();
  for (const wave of waves) sizes.set(wave, (sizes.get(wave) ?? 0) + 1);
  return tasks.map((task, index) => {
    const wave = waves[index] ?? 1;
    return { ...task, wave, parallel: (sizes.get(wave) ?? 1) > 1 };
  });
}

export function orderTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => left.wave - right.wave);
}

export function validateTaskList(
  list: TaskList,
  spec: Spec,
  discovery: RepositoryDiscovery,
  repositoryPaths: string[] = discovery.context.files,
): void {
  if (list.feature !== spec.feature) throw new Error("Task list feature does not match plan");
  if (list.status === "needs_clarification") {
    if (list.questions.length === 0) throw new Error("Clarification task list has no questions");
    if (list.tasks.length === 0) return;
  } else {
    if (list.questions.length > 0) throw new Error("Ready task list must not contain questions");
    if (list.tasks.length === 0) throw new Error("Ready task list has no tasks");
  }

  const requirements = new Set(spec.requirements.map((item) => item.id));
  const acceptance = new Set(spec.acceptance.map((item) => item.id));
  const coveredRequirements = new Set<string>();
  const coveredAcceptance = new Set<string>();
  const taskIds = new Set(list.tasks.map((task) => task.id));
  const approvedFiles = new Set(discovery.context.files);
  const existingFiles = new Set(repositoryPaths);
  const tasksById = new Map(list.tasks.map((task) => [task.id, task]));

  for (const task of list.tasks) {
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

  if (list.status === "ready") {
    assertCoverage(requirements, coveredRequirements, "requirements");
    assertCoverage(acceptance, coveredAcceptance, "acceptance criteria");
    assertExclusiveAcceptance(list.tasks);
    assertOwnersCanProve(list.tasks);
  }
  assertAcyclic(list.tasks);
}

export function validateTaskListReview(review: TaskListReview): void {
  const passed = new Set(review.checks.filter((check) => check.passed).map((check) => check.id));
  const missing = Array.from({ length: 10 }, (_, index) => `C${index + 1}`).filter(
    (id) => !passed.has(id),
  );
  if (missing.length > 0) throw new Error(`Task review failed checks: ${missing.join(", ")}`);
}

function assertAcyclic(tasks: Task[]): void {
  const dependencies = new Map(tasks.map((task) => [task.id, task.depends_on]));
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

/**
 * An acceptance criterion belongs to exactly one task.
 *
 * A criterion is a test, and a test has one home. Letting several tasks claim the same one makes the
 * per-task review impossible to satisfy — no single task implements a criterion the graph split
 * between four — and it destroys credit assignment: a failing criterion no longer names a task.
 *
 * Coverage becomes a partition rather than a cover, which is what makes it checkable here.
 */
function assertExclusiveAcceptance(tasks: Task[]): void {
  const owners = new Map<string, string[]>();
  for (const task of tasks) {
    for (const id of task.acceptance) {
      owners.set(id, [...(owners.get(id) ?? []), task.id]);
    }
  }
  const shared = [...owners.entries()].filter(([, claimants]) => claimants.length > 1);
  if (shared.length > 0) {
    const detail = shared.map(([id, claimants]) => `${id} by ${claimants.join(", ")}`).join("; ");
    throw new Error(`Acceptance criteria must be owned by exactly one task: ${detail}`);
  }
}

/**
 * A criterion's owner must be able to prove it.
 *
 * A task that owns criteria, writes nothing but tests, and depends on no one runs before the code it
 * tests exists — its test cannot even compile. That is unprovable by construction, so it is caught
 * here rather than by a blocker halfway through execution.
 *
 * A test-only task with no dependencies is fine when nothing else writes source: the behaviour it
 * covers already exists, and the test is simply being added.
 */
function assertOwnersCanProve(tasks: Task[]): void {
  const someoneWritesSource = tasks.some((task) =>
    [...task.files.modify, ...task.files.create].some(isBehaviouralSource),
  );
  if (!someoneWritesSource) return;
  for (const task of tasks) {
    if (task.acceptance.length === 0) continue;
    if (!writesOnlyTests(task.files)) continue;
    if (task.depends_on.length > 0) continue;
    throw new Error(
      `${task.id} owns ${task.acceptance.join(", ")} but only writes tests and depends on nothing, ` +
        "so it runs before the code under test exists",
    );
  }
}

function assertCoverage(expected: Set<string>, actual: Set<string>, label: string): void {
  const missing = [...expected].filter((id) => !actual.has(id));
  if (missing.length > 0)
    throw new Error(`Task list does not cover ${label}: ${missing.join(", ")}`);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function availableFiles(
  taskId: string,
  tasks: Map<string, Task>,
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
