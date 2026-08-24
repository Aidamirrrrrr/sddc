import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicy, loadPolicy } from "./load";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("policy loader uses defaults and merges project overrides", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-policy-"));
  expect(await loadPolicy(root)).toEqual(defaultPolicy);
  const directory = join(root, ".spec-agent");
  await mkdir(directory);
  await Bun.write(join(directory, "policy.yaml"), "changes:\n  max_files_per_task: 2\n");

  const policy = await loadPolicy(root);

  expect(policy.changes.max_files_per_task).toBe(2);
  expect(policy.commands.allowed_programs).toEqual(defaultPolicy.commands.allowed_programs);
});

test("policy loader reports malformed project policy", async () => {
  root = await mkdtemp(join(tmpdir(), "spec-agent-policy-invalid-"));
  const directory = join(root, ".spec-agent");
  await mkdir(directory);
  const path = join(directory, "policy.yaml");
  await Bun.write(path, "commands:\n  allowed_programs: []\n");

  expect(loadPolicy(root)).rejects.toThrow(`Failed to load policy "${path}"`);
});
