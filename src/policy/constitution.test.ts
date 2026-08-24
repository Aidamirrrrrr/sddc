import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConstitution } from "./constitution";

test("a missing constitution is not an error", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-constitution-missing-"));

  expect(await loadConstitution(root)).toBe("");
});

test("constitution principles are loaded as prose", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-constitution-"));
  await Bun.write(join(root, ".sddc/constitution.md"), "# Principles\n\nTest first.\n");

  expect(await loadConstitution(root)).toBe("# Principles\n\nTest first.");
});

test("an oversized constitution is rejected instead of truncated", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-constitution-large-"));
  await Bun.write(join(root, ".sddc/constitution.md"), "x".repeat(17_000));

  expect(loadConstitution(root)).rejects.toThrow("larger than");
});
