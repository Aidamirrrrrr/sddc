import { expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./context";
import { applyProposal, restoreFiles } from "./files";

test("applied files can be restored exactly", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-files-"));
  await Bun.write(join(root, "existing.ts"), "old\n");
  const backup = await applyProposal(root, {
    task_id: "T1",
    status: "ready",
    summary: "Change files",
    blocker: null,
    traceability: [{ covers: "R1", paths: ["existing.ts"] }],
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
  const root = await mkdtemp(join(tmpdir(), "sddc-stale-"));
  await Bun.write(join(root, "file.ts"), "newer\n");
  await expect(
    applyProposal(root, {
      task_id: "T1",
      status: "ready",
      summary: "Stale change",
      blocker: null,
      traceability: [{ covers: "R1", paths: ["file.ts"] }],
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
  const root = await mkdtemp(join(tmpdir(), "sddc-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "sddc-outside-"));
  await symlink(outside, join(root, "linked"));

  await expect(
    applyProposal(root, {
      task_id: "T1",
      status: "ready",
      summary: "Unsafe create",
      blocker: null,
      traceability: [{ covers: "R1", paths: ["linked/file.ts"] }],
      changes: [
        { path: "linked/file.ts", operation: "create", expected_sha256: null, content: "bad\n" },
      ],
    }),
  ).rejects.toThrow("Symbolic links are not writable");
  expect(await Bun.file(join(outside, "file.ts")).exists()).toBe(false);
});

test("a rolled-back task leaves no directory it created", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-dirs-"));
  const backup = await applyProposal(root, {
    task_id: "T1",
    status: "ready",
    summary: "Create a nested file",
    blocker: null,
    traceability: [{ covers: "R1", paths: ["src/feature/deep/thing.ts"] }],
    changes: [
      {
        path: "src/feature/deep/thing.ts",
        operation: "create",
        expected_sha256: null,
        content: "created\n",
      },
    ],
  });

  await restoreFiles(root, backup);

  // "Restored exactly as if the task had never started" has to include the directories the task had
  // to make on its way to the file, or an empty src/feature/deep survives into someone's git status.
  expect(await Bun.file(join(root, "src/feature/deep/thing.ts")).exists()).toBe(false);
  for (const directory of ["src/feature/deep", "src/feature", "src"]) {
    expect(await exists(join(root, directory))).toBe(false);
  }
});

test("a directory that was already there survives a rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-keepdir-"));
  await mkdir(join(root, "src/existing"), { recursive: true });
  const backup = await applyProposal(root, {
    task_id: "T1",
    status: "ready",
    summary: "Create a file in an existing directory",
    blocker: null,
    traceability: [{ covers: "R1", paths: ["src/existing/thing.ts"] }],
    changes: [
      {
        path: "src/existing/thing.ts",
        operation: "create",
        expected_sha256: null,
        content: "created\n",
      },
    ],
  });

  await restoreFiles(root, backup);

  // Empty after the file goes, but it was empty before too — pruning by emptiness rather than by
  // what the task actually created would delete somebody else's directory.
  expect(await exists(join(root, "src/existing"))).toBe(true);
});

test("a directory holding somebody else's file is left alone", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-sharedir-"));
  const backup = await applyProposal(root, {
    task_id: "T1",
    status: "ready",
    summary: "Create a nested file",
    blocker: null,
    traceability: [{ covers: "R1", paths: ["src/new/mine.ts"] }],
    changes: [
      { path: "src/new/mine.ts", operation: "create", expected_sha256: null, content: "mine\n" },
    ],
  });
  await Bun.write(join(root, "src/new/theirs.ts"), "theirs\n");

  await restoreFiles(root, backup);

  expect(await Bun.file(join(root, "src/new/theirs.ts")).text()).toBe("theirs\n");
  expect(await exists(join(root, "src/new"))).toBe(true);
});

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
