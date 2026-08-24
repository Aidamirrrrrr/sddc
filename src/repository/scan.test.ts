import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexRepository, readSnapshots } from "./scan";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("repository scanner", () => {
  test("excludes secrets and generated directories", async () => {
    root = await mkdtemp(join(tmpdir(), "codekeeper-scan-"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await Bun.write(join(root, "src/main.ts"), "export const main = true;");
    await Bun.write(join(root, ".env"), "SECRET=value");
    await Bun.write(join(root, ".env.example"), "SECRET=");
    await Bun.write(join(root, "node_modules/package.js"), "ignored");

    const index = await indexRepository(root);

    expect(index.map((file) => file.path)).toEqual([".env.example", "src/main.ts"]);
  });

  test("reads only paths present in the safe index", async () => {
    root = await mkdtemp(join(tmpdir(), "codekeeper-snapshot-"));
    await Bun.write(join(root, "package.json"), '{"name":"example"}');
    await Bun.write(join(root, ".env"), "SECRET=value");
    const index = await indexRepository(root);

    const snapshots = await readSnapshots(root, index, ["package.json", ".env", "missing.ts"]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.path).toBe("package.json");
  });
});
