import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitCheckpoint } from "./checkpoint";

/**
 * A checkpoint commits into the user's own repository, which is the most consequential thing this
 * tool does to state it does not own. It is off by default for that reason, and what it refuses to
 * do matters more than what it does.
 */
async function git(root: string, ...args: string[]): Promise<number> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return child.exited;
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-checkpoint-"));
  await git(root, "init", "--quiet");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "commit.gpgsign", "false");
  await Bun.write(join(root, "src/auth.ts"), "original\n");
  await git(root, "add", ".");
  await git(root, "commit", "--quiet", "--no-verify", "-m", "initial");
  return root;
}

async function revisionCount(root: string): Promise<number> {
  const child = Bun.spawn(["git", "rev-list", "--count", "HEAD"], { cwd: root, stdout: "pipe" });
  return Number((await new Response(child.stdout).text()).trim());
}

test("a checkpoint commits the task's files and returns the revision", async () => {
  const root = await repository();
  await Bun.write(join(root, "src/auth.ts"), "changed\n");

  const revision = await createGitCheckpoint(root, "T1", ["src/auth.ts"]);

  expect(revision).toMatch(/^[0-9a-f]{40}$/);
  expect(await revisionCount(root)).toBe(2);
});

test("a checkpoint refuses while unrelated work is staged", async () => {
  const root = await repository();
  await Bun.write(join(root, "unrelated.ts"), "staged by the user\n");
  await git(root, "add", "unrelated.ts");
  await Bun.write(join(root, "src/auth.ts"), "changed\n");

  // Committing here would sweep the user's own staged work into a commit the tool wrote and
  // attributed to a task that never touched it.
  await expect(createGitCheckpoint(root, "T1", ["src/auth.ts"])).rejects.toThrow(
    "Cannot checkpoint while unrelated changes are staged",
  );
  expect(await revisionCount(root)).toBe(1);
});
