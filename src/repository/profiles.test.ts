import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listContextProfiles, writeContextProfile } from "./profiles";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("context profiles persist project file selections", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-profile-"));
  const profile = {
    name: "Backend auth",
    files: ["src/auth.ts", "src/auth.test.ts"],
    user_context: "Replace the legacy flow",
  };

  const path = await writeContextProfile(root, profile);

  expect(path).toEndWith(".specs/context-profiles/backend-auth.yaml");
  expect(await listContextProfiles(root)).toEqual([profile]);
});

test("context profile names support the user's language", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-profile-language-"));

  const path = await writeContextProfile(root, {
    name: "Авторизация API",
    files: ["src/auth.ts"],
    user_context: "",
  });

  expect(path).toEndWith(".specs/context-profiles/авторизация-api.yaml");
});

test("context profiles report malformed files", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-profile-invalid-"));
  const directory = join(root, ".specs", "context-profiles");
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, "broken.yaml"), "name: broken\nfiles: invalid");

  expect(listContextProfiles(root)).rejects.toThrow(
    `Failed to load context profile "${join(directory, "broken.yaml")}"`,
  );
});
