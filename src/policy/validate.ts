import type { Spec } from "../spec/schemas";
import type { Task } from "../tasks/schemas";
import { isBehaviouralSource, isTestPath, writesOnlyTests } from "./paths";
import type { Policy } from "./schemas";

/** What a criterion proves, so "the test covering this task" can mean something checkable. */
export type AcceptanceCoverage = Pick<Spec, "acceptance">;

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

export function validateTaskPolicy(
  tasks: Task[],
  policy: Policy,
  coverage?: AcceptanceCoverage,
): void {
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
  assertOwnersCanProve(tasks, policy);
  if (policy.changes.require_test_before_implementation) validateTestFirst(tasks, coverage);
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
function validateTestFirst(tasks: Task[], coverage?: AcceptanceCoverage): void {
  const writesTest = (task: Task): boolean =>
    [...task.files.modify, ...task.files.create].some(isTestPath);

  // What each acceptance criterion verifies, so a test task can be tied to the work it proves.
  const verifies = new Map(
    (coverage?.acceptance ?? []).map((item) => [item.id, new Set(item.verifies)]),
  );
  /**
   * Whether a test task proves *this* task rather than merely existing before it.
   *
   * Any-test-will-do let one decorative test task in the root satisfy the article for the whole
   * graph, which is the letter of Article III without its substance. The link is the requirement:
   * either both tasks serve it, or the test task owns a criterion that verifies it.
   */
  const proves = (test: Task, task: Task): boolean => {
    const served = new Set(task.requirements);
    if (test.requirements.some((id) => served.has(id))) return true;
    return test.acceptance.some((id) =>
      [...(verifies.get(id) ?? [])].some((requirement) => served.has(requirement)),
    );
  };

  for (const task of tasks) {
    const source = [...task.files.modify, ...task.files.create].filter(isBehaviouralSource);
    if (source.length === 0) continue;
    const earlier = tasks.filter(
      (other) =>
        other.id !== task.id && writesTest(other) && dependsTransitively(task.id, other.id, tasks),
    );
    if (earlier.length === 0) {
      throw new Error(
        `${task.id} changes ${source.join(", ")} without depending on a task that writes a test`,
      );
    }
    if (!earlier.some((test) => proves(test, task))) {
      throw new Error(
        `${task.id} changes ${source.join(", ")} but no test it depends on ` +
          `(${earlier.map((test) => test.id).join(", ")}) covers ${task.requirements.join(", ")}`,
      );
    }
  }
}

/**
 * A criterion's owner must be able to prove it — unless test-first says otherwise.
 *
 * A task owning criteria that writes only tests and waits for nobody normally runs before the code
 * under test exists, so its test cannot even compile. Under require_test_before_implementation that
 * is the prescribed shape: the test lands first and is expected to fail until the implementation
 * arrives. Enforcing both at once left no satisfiable graph, which is how this ended up next to the
 * rule it has to agree with.
 */
function assertOwnersCanProve(tasks: Task[], policy: Policy): void {
  if (policy.changes.require_test_before_implementation) return;
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

/**
 * Two tasks writing the same file must be ordered by a dependency — in either direction.
 *
 * The order they happen to occupy in the array is not the order they run in: waves come from the
 * graph. Requiring the *later-indexed* task to be the dependent one rejected valid graphs whose
 * dependency pointed the other way, which is the same mistake as a validator demanding what another
 * one forbids: the rule has to be stated over the graph, because the graph is what executes.
 */
function validateWriteOrdering(tasks: Task[]): void {
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (!task) continue;
    const writes = new Set([...task.files.modify, ...task.files.create]);
    for (const other of tasks.slice(index + 1)) {
      const overlap = [...other.files.modify, ...other.files.create].find((path) =>
        writes.has(path),
      );
      if (!overlap) continue;
      const ordered =
        dependsTransitively(other.id, task.id, tasks) ||
        dependsTransitively(task.id, other.id, tasks);
      if (!ordered) {
        throw new Error(`${task.id} and ${other.id} both change ${overlap} without ordering`);
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
