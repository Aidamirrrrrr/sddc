import { expect, test } from "bun:test";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { sha256 } from "./context";
import { validateProposal } from "./validate";

test("proposal accepts only approved task writes with current hashes", () => {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const content = "export const value = 1;\n";
  const files = [{ path: "src/auth.ts", content, sha256: sha256(content) }];

  expect(() =>
    validateProposal(
      {
        task_id: task.id,
        status: "ready",
        summary: "Update auth",
        blocker: null,
        traceability: [
          { requirement_id: "R1", paths: ["src/auth.ts"] },
          { requirement_id: "A1", paths: ["src/auth.ts"] },
        ],
        changes: [
          {
            path: "src/auth.ts",
            operation: "modify",
            expected_sha256: sha256(content),
            content: "export const value = 2;\n",
          },
        ],
      },
      task,
      files,
    ),
  ).not.toThrow();

  expect(() =>
    validateProposal(
      {
        task_id: task.id,
        status: "ready",
        summary: "Escape scope",
        blocker: null,
        traceability: [
          { requirement_id: "R1", paths: [".env"] },
          { requirement_id: "A1", paths: [".env"] },
        ],
        changes: [
          { path: ".env", operation: "modify", expected_sha256: sha256(content), content: "x" },
        ],
      },
      task,
      files,
    ),
  ).toThrow("may not modify .env");
});

test("proposal must implement every planned file within the size limit", () => {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  task.files.create.push("src/registration.ts");
  const content = "old\n";
  const files = [{ path: "src/auth.ts", content, sha256: sha256(content) }];
  const proposal = {
    task_id: task.id,
    status: "ready" as const,
    summary: "Incomplete",
    blocker: null,
    traceability: [
      { requirement_id: "R1", paths: ["src/auth.ts"] },
      { requirement_id: "A1", paths: ["src/auth.ts"] },
    ],
    changes: [
      {
        path: "src/auth.ts",
        operation: "modify" as const,
        expected_sha256: sha256(content),
        content: "new\n",
      },
    ],
  };

  expect(() => validateProposal(proposal, task, files)).toThrow(
    "omits planned change: src/registration.ts",
  );
  expect(() =>
    validateProposal(proposal, task, files, {
      ...defaultPolicy,
      changes: { ...defaultPolicy.changes, max_generated_file_bytes: 2, forbid_paths: [] },
    }),
  ).toThrow("generates an oversized file: src/auth.ts");
});
