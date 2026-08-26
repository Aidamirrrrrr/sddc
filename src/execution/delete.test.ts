import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { restoreFiles } from "./files";
import { finishCall, removeCall, writeCall } from "./tool-fixtures";
import { createToolHost } from "./tools";
import { validateProposal } from "./validate";

/**
 * A rename is a create and a delete in one task, and until now the second half could not be said at
 * all — in a tool whose whole subject is controlled project change.
 */
function task(): Task {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return {
    ...first,
    acceptance: [],
    requirements: ["R1"],
    files: {
      read: [],
      modify: [],
      create: ["src/renamed.ts"],
      delete: ["src/old.ts"],
    },
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-delete-"));
  await Bun.write(join(root, "src/old.ts"), "export const value = 1;\n");
  await Bun.write(join(root, "src/keep.ts"), "untouched\n");
  return root;
}

function host(root: string) {
  return createToolHost({ root, task: task(), policy: defaultPolicy });
}

test("a rename is a create and a delete in one task", async () => {
  const root = await workspace();
  const tools = host(root);

  await tools.execute(writeCall("src/renamed.ts", "export const value = 1;\n"));
  await tools.execute(removeCall("src/old.ts"));
  const outcome = await tools.execute(
    finishCall("Rename the module", [{ covers: "R1", paths: ["src/renamed.ts", "src/old.ts"] }]),
  );

  expect(await Bun.file(join(root, "src/old.ts")).exists()).toBe(false);
  expect(await Bun.file(join(root, "src/renamed.ts")).text()).toBe("export const value = 1;\n");
  expect(outcome.kind).toBe("finish");
  if (outcome.kind !== "finish") return;
  expect(outcome.proposal.changes.map((change) => `${change.operation} ${change.path}`)).toEqual([
    "create src/renamed.ts",
    "delete src/old.ts",
  ]);
});

test("a removal outside the approved scope never happens", async () => {
  const root = await workspace();

  const outcome = await host(root).execute(removeCall("src/keep.ts"));

  expect(outcome.kind === "continue" && outcome.result.ok).toBe(false);
  expect(await Bun.file(join(root, "src/keep.ts")).text()).toBe("untouched\n");
});

test("a rolled-back removal puts the file back byte for byte", async () => {
  const root = await workspace();
  const tools = host(root);

  await tools.execute(removeCall("src/old.ts"));
  expect(await Bun.file(join(root, "src/old.ts")).exists()).toBe(false);

  await restoreFiles(root, tools.backup());

  // A removal is the one change whose undo is its content, which is why the backup holds it.
  expect(await Bun.file(join(root, "src/old.ts")).text()).toBe("export const value = 1;\n");
});

test("the validator counts the lines a removal takes away", () => {
  const content = "one\ntwo\nthree\n";
  const files = [{ path: "src/old.ts", content, sha256: "irrelevant" }];
  const tight = {
    ...defaultPolicy,
    execution: { ...defaultPolicy.execution, max_changed_lines_per_task: 2 },
  };
  const removeOnly = {
    ...task(),
    files: { read: [], modify: [], create: [], delete: ["src/old.ts"] },
  };

  // A removal that fit under no limit at all would be the one way to make an arbitrarily large
  // change without the policy noticing.
  expect(() =>
    validateProposal(
      {
        task_id: removeOnly.id,
        status: "ready",
        summary: "Remove it",
        blocker: null,
        traceability: [{ covers: "R1", paths: ["src/old.ts"] }],
        changes: [
          { path: "src/old.ts", operation: "delete", expected_sha256: "irrelevant", content: "" },
        ],
      },
      removeOnly,
      files,
      tight,
    ),
  ).toThrow("changes approximately 4 lines");
});
