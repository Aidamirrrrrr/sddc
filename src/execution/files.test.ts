import { expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./context";
import { applyProposal, restoreFiles } from "./files";

test("applied files can be restored exactly", async () => {
  const root = await mkdtemp(join(tmpdir(), "codekeeper-files-"));
  await Bun.write(join(root, "existing.ts"), "old\n");
  const backup = await applyProposal(root, {
    task_id: "T1",
    status: "ready",
    summary: "Change files",
    blocker: null,
    traceability: [{ requirement_id: "R1", paths: ["existing.ts"] }],
    changes: [
      {
        path: "existing.ts",
        operation: "modify",
        expected_sha256: sha256("old\n"),
        content: "new\n",
      },
      { path: "new.ts", operation: "create", expected_sha256: null, content: "created\n" },
    ],
  });

  await restoreFiles(root, backup);
  expect(await Bun.file(join(root, "existing.ts")).text()).toBe("old\n");
  expect(await Bun.file(join(root, "new.ts")).exists()).toBe(false);
});

test("apply rejects a file changed after proposal generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "codekeeper-stale-"));
  await Bun.write(join(root, "file.ts"), "newer\n");
  await expect(
    applyProposal(root, {
      task_id: "T1",
      status: "ready",
      summary: "Stale change",
      blocker: null,
      traceability: [{ requirement_id: "R1", paths: ["file.ts"] }],
      changes: [
        {
          path: "file.ts",
          operation: "modify",
          expected_sha256: sha256("older\n"),
          content: "result\n",
        },
      ],
    }),
  ).rejects.toThrow("File changed after proposal was created");
});

test("apply rejects destinations through symbolic links", async () => {
  const root = await mkdtemp(join(tmpdir(), "codekeeper-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "codekeeper-outside-"));
  await symlink(outside, join(root, "linked"));

  await expect(
    applyProposal(root, {
      task_id: "T1",
      status: "ready",
      summary: "Unsafe create",
      blocker: null,
      traceability: [{ requirement_id: "R1", paths: ["linked/file.ts"] }],
      changes: [
        { path: "linked/file.ts", operation: "create", expected_sha256: null, content: "bad\n" },
      ],
    }),
  ).rejects.toThrow("Symbolic links are not writable");
  expect(await Bun.file(join(outside, "file.ts")).exists()).toBe(false);
});
