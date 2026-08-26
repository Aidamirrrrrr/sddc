import { expect, test } from "bun:test";
import { isForbiddenPath, isSafeProjectPath } from "./paths";

test("a path must stay inside the project and away from its secrets", () => {
  expect(isSafeProjectPath("src/auth.ts")).toBe(true);
  expect(isSafeProjectPath("../outside.ts")).toBe(false);
  expect(isSafeProjectPath("/etc/passwd")).toBe(false);
  expect(isSafeProjectPath(".git/config")).toBe(false);
  expect(isSafeProjectPath(".specs/registration/spec.yaml")).toBe(false);
  expect(isSafeProjectPath("secrets/server.pem")).toBe(false);
  expect(isSafeProjectPath(".env")).toBe(false);
  // Checked in on purpose: it documents the variables rather than holding them.
  expect(isSafeProjectPath(".env.example")).toBe(true);
});

test("the forbidden family covers the secrets but not the example that documents them", () => {
  const forbidden = [".git", ".specs", ".env", "credentials"];

  expect(isForbiddenPath(".env", forbidden)).toBe(true);
  expect(isForbiddenPath(".env.local", forbidden)).toBe(true);
  expect(isForbiddenPath("credentials.json", forbidden)).toBe(true);
  expect(isForbiddenPath(".specs/registration/spec.yaml", forbidden)).toBe(true);

  // The repository walker indexes this one on purpose. Forbidding it here left the two halves of
  // the tool disagreeing about a single file.
  expect(isForbiddenPath(".env.example", forbidden)).toBe(false);
  expect(isForbiddenPath("src/environment.ts", forbidden)).toBe(false);
});
