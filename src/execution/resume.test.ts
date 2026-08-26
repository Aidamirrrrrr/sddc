import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./context";
import { validateResume } from "./resume";
import type { ExecutionJournal } from "./schemas";

/**
 * The one thing standing between an interrupted run and silent corruption.
 *
 * Resuming means trusting that everything a previous session recorded as completed is still on disk
 * exactly as it left it. If somebody edited one of those files in between, the remaining tasks would
 * be built against a workspace nobody has ever verified.
 */
function journal(tasks: ExecutionJournal["tasks"]): ExecutionJournal {
  return {
    feature: "registration",
    status: "in_progress",
    mode: "normal",
    pending_feedback: null,
    tasks,
  };
}

function completed(path: string, content: string): ExecutionJournal["tasks"][number] {
  return {
    task_id: "T1",
    status: "completed",
    changed_files: [path],
    verification: [{ program: "bun", args: ["test"], exit_code: 0, timed_out: false, output: "" }],
    output_hashes: [{ path, sha256: sha256(content) }],
    checkpoint: null,
  };
}

async function workspace(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-resume-"));
  await Bun.write(join(root, "src/auth.ts"), content);
  return root;
}

test("a workspace matching the journal resumes", async () => {
  const root = await workspace("written\n");

  await expect(
    validateResume(root, journal([completed("src/auth.ts", "written\n")])),
  ).resolves.toBeUndefined();
});

test("a completed file edited since the run refuses to resume", async () => {
  const root = await workspace("edited by hand\n");

  await expect(
    validateResume(root, journal([completed("src/auth.ts", "written\n")])),
  ).rejects.toThrow("Cannot resume: completed file changed: src/auth.ts");
});

test("a completed file that is gone refuses to resume", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-resume-gone-"));

  await expect(
    validateResume(root, journal([completed("src/auth.ts", "written\n")])),
  ).rejects.toThrow("Cannot resume: completed file changed: src/auth.ts");
});

test("a failed task is not held against the resume", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-resume-failed-"));
  // Its changes were rolled back when it failed, so the files it names are supposed to be absent.
  const failed = { ...completed("src/auth.ts", "written\n"), status: "failed" as const };

  await expect(validateResume(root, journal([failed]))).resolves.toBeUndefined();
});
