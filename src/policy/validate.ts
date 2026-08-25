import type { Task } from "../tasks/schemas";
import { isBehaviouralSource, isTestPath } from "./paths";
import type { Policy } from "./schemas";

const DEPENDENCY_FILES = new Set([
  "Cargo.lock",
  "Cargo.toml",
  "bun.lock",
  "deno.json",
  "deno.jsonc",
  "go.mod",
  "go.sum",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "requirements.txt",
  "yarn.lock",
]);

export function validateTaskPolicy(tasks: Task[], policy: Policy): void {
  for (const task of tasks) {
    const changed = [...new Set([...task.files.modify, ...task.files.create])];
    if (changed.length > policy.changes.max_files_per_task) {
      throw new Error(
        `${task.id} changes ${changed.length} files; policy allows ${policy.changes.max_files_per_task}`,
      );
    }
    if (task.files.create.length > policy.changes.max_created_files_per_task) {
      throw new Error(
        `${task.id} creates ${task.files.create.length} files; policy allows ${policy.changes.max_created_files_per_task}`,
      );
    }
    for (const path of changed) validateChangedPath(task, path, policy);
    for (const verification of task.verification) {
      if (!policy.commands.allowed_programs.includes(verification.command.program)) {
        throw new Error(
          `${task.id} uses command not allowed by policy: ${verification.command.program}`,
        );
      }
      if (usesExternalNetwork(verification.command.program, verification.command.args)) {
        if (!policy.commands.allow_external_network) {
          throw new Error(`${task.id} uses external network forbidden by policy`);
        }
        if (!task.permissions.includes("external_network")) {
          throw new Error(`${task.id} uses external network without permission`);
        }
      }
    }
    if (!policy.commands.allow_external_network && task.permissions.includes("external_network")) {
      throw new Error(`${task.id} requests external network forbidden by policy`);
    }
  }
  validateWriteOrdering(tasks);
  if (policy.changes.require_test_before_implementation) validateTestFirst(tasks);
}

function usesExternalNetwork(program: string, args: string[]): boolean {
  const command = program.toLocaleLowerCase();
  const action = args[0]?.toLocaleLowerCase();
  if (["curl", "wget"].includes(command)) return true;
  if (["npm", "pnpm", "yarn", "bun"].includes(command)) {
    return ["add", "i", "install", "update", "upgrade"].includes(action ?? "");
  }
  if (command === "cargo") return ["add", "install", "update"].includes(action ?? "");
  if (["pip", "pip3"].includes(command)) return action === "install";
  return false;
}

function validateChangedPath(task: Task, path: string, policy: Policy): void {
  if (policy.changes.forbid_paths.some((forbidden) => matchesPath(path, forbidden))) {
    throw new Error(`${task.id} changes path forbidden by policy: ${path}`);
  }
  const name = path.split("/").at(-1) ?? path;
  if (
    policy.changes.require_dependency_permission &&
    DEPENDENCY_FILES.has(name) &&
    !task.permissions.includes("dependencies")
  ) {
    throw new Error(`${task.id} changes dependency file without permission: ${path}`);
  }
  if (
    policy.changes.require_configuration_permission &&
    isConfiguration(path) &&
    !task.permissions.includes("configuration")
  ) {
    throw new Error(`${task.id} changes configuration without permission: ${path}`);
  }
  if (
    policy.changes.require_migration_permission &&
    path.split("/").some((part) => part.toLocaleLowerCase() === "migrations") &&
    !task.permissions.includes("migration")
  ) {
    throw new Error(`${task.id} changes migration without permission: ${path}`);
  }
}

/**
 * SDD Article III, enforced on the graph rather than asked for in a prompt.
 *
 * A task that changes behavioural source must depend — directly or transitively — on a task that
 * writes a test. Writing the test in the same task is deliberately not enough: "first" would then
 * mean nothing, and the ordering is exactly what the article is about.
 */
function validateTestFirst(tasks: Task[]): void {
  const writesTest = (task: Task): boolean =>
    [...task.files.modify, ...task.files.create].some(isTestPath);

  for (const task of tasks) {
    const source = [...task.files.modify, ...task.files.create].filter(isBehaviouralSource);
    if (source.length === 0) continue;
    const covered = tasks.some(
      (other) =>
        other.id !== task.id && writesTest(other) && dependsTransitively(task.id, other.id, tasks),
    );
    if (!covered) {
      throw new Error(
        `${task.id} changes ${source.join(", ")} without depending on a task that writes a test`,
      );
    }
  }
}

function validateWriteOrdering(tasks: Task[]): void {
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) continue;
    const writes = new Set([...task.files.modify, ...task.files.create]);
    for (const later of tasks.slice(index + 1)) {
      const overlap = [...later.files.modify, ...later.files.create].find((path) =>
        writes.has(path),
      );
      if (overlap && !dependsTransitively(later.id, task.id, tasks)) {
        throw new Error(`${task.id} and ${later.id} both change ${overlap} without ordering`);
      }
    }
  }
}

function dependsTransitively(
  taskId: string,
  dependencyId: string,
  tasks: Task[],
  visited = new Set<string>(),
): boolean {
  if (visited.has(taskId)) return false;
  visited.add(taskId);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return false;
  return task.depends_on.some(
    (id) => id === dependencyId || dependsTransitively(id, dependencyId, tasks, visited),
  );
}

function matchesPath(path: string, forbidden: string): boolean {
  const parts = path.toLocaleLowerCase().split("/");
  const target = forbidden.toLocaleLowerCase();
  return parts.includes(target) || parts.at(-1)?.startsWith(`${target}.`) === true;
}

function isConfiguration(path: string): boolean {
  const name = path.split("/").at(-1)?.toLocaleLowerCase() ?? "";
  return (
    name.startsWith("tsconfig") ||
    name.startsWith("biome.json") ||
    name === "eslint.config.js" ||
    name === "eslint.config.mjs" ||
    path.startsWith(".github/")
  );
}
