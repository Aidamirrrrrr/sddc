/**
 * What counts as a test file.
 *
 * Deliberately conservative and shared: the context selector labels files with it and the test-first
 * rule enforces against it, and those two must not be allowed to drift apart.
 */
const TEST_PATH = /(^|\/)(__tests__|tests?|specs?)(\/|\.|$)|[._-](test|spec)\.[^.]+$/i;

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

/**
 * Files a change to which needs a test behind it. Configuration, docs and lockfiles carry no
 * behaviour to assert, so demanding a test for them would only teach users to switch the rule off.
 */
const NON_BEHAVIOURAL =
  /(^|\/)(package\.json|bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|biome\.json|\.github\/.*|Dockerfile|Makefile)$|\.(md|txt|ya?ml|toml|ini|cfg|lock|json5?)$/i;

export function isBehaviouralSource(path: string): boolean {
  return !isTestPath(path) && !NON_BEHAVIOURAL.test(path);
}

/**
 * A task that writes tests and nothing else.
 *
 * Derived from the task's own file list rather than declared, so a model cannot label a task this
 * way to change how its verification is judged.
 */
export function writesOnlyTests(files: { modify: string[]; create: string[] }): boolean {
  const written = [...files.modify, ...files.create];
  return written.length > 0 && written.every(isTestPath);
}

/**
 * Test files that, by the project's own naming, cover a given source file.
 *
 * Only conventional siblings, and only ever used to check against paths that actually exist in the
 * repository — so a project with a different layout is simply never constrained by this.
 */
export function conventionalTestPaths(source: string): string[] {
  const match = /^(.*?)([^/]+)\.([^./]+)$/.exec(source);
  if (!match) return [];
  const [, directory, name, extension] = match;
  if (name === undefined || extension === undefined) return [];
  const base = `${directory ?? ""}${name}`;
  return [
    `${base}.test.${extension}`,
    `${base}.spec.${extension}`,
    `${base}_test.${extension}`,
    `${directory ?? ""}__tests__/${name}.test.${extension}`,
    `${directory ?? ""}__tests__/${name}.${extension}`,
  ];
}

/**
 * A path a task may name at all: inside the project, and not a file the tool refuses to touch.
 *
 * Lived privately in the task validator until a second caller needed it — the execution phase now
 * checks a model's read request against the same rule the graph was checked against. Two copies of
 * "which paths are off limits" is exactly the drift this module exists to prevent.
 */
export function isSafeProjectPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  const lower = parts.at(-1)?.toLocaleLowerCase() ?? "";
  if (parts.includes(".git") || parts.includes(".specs")) return false;
  if (lower === ".env" || (lower.startsWith(".env.") && lower !== ".env.example")) return false;
  return !lower.endsWith(".pem") && !lower.endsWith(".key");
}

/** Whether a path is covered by one of the policy's forbidden names. */
export function isForbiddenPath(path: string, forbidden: string[]): boolean {
  const parts = path.toLocaleLowerCase().split("/");
  return forbidden.some((name) => {
    const target = name.toLocaleLowerCase();
    return parts.includes(target) || parts.at(-1)?.startsWith(`${target}.`) === true;
  });
}
