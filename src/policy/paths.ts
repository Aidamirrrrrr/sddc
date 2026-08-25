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
