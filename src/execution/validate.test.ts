import { expect, test } from "bun:test";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { sha256 } from "./context";
import type { ChangeProposal } from "./schemas";
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
          { covers: "R1", paths: ["src/auth.ts"] },
          { covers: "A1", paths: ["src/auth.ts"] },
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
          { covers: "R1", paths: [".env"] },
          { covers: "A1", paths: [".env"] },
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
      { covers: "R1", paths: ["src/auth.ts"] },
      { covers: "A1", paths: ["src/auth.ts"] },
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

test("a task that blocks on files it may already write is rejected, not obeyed", () => {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const blocked = {
    task_id: task.id,
    status: "blocked" as const,
    summary: "Cannot proceed",
    blocker: {
      // Observed in a real run: the model refused a task using a file the task already grants it.
      reason: "src/auth.ts is listed in files.read but not files.modify",
      required_files: ["src/auth.ts"],
      required_decision: "Add src/auth.ts to files.modify",
    },
    traceability: [],
    changes: [],
  };

  expect(() => validateProposal(blocked, task, [])).toThrow(
    "blocked on files it may already write: src/auth.ts",
  );
});

test("a blocker naming a file outside the approved scope still stops the run", () => {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const blocked = {
    task_id: task.id,
    status: "blocked" as const,
    summary: "Needs another file",
    blocker: {
      reason: "The change also requires the router",
      required_files: ["src/router.ts"],
      required_decision: "Extend the plan to cover routing",
    },
    traceability: [],
    changes: [],
  };

  expect(() => validateProposal(blocked, task, [])).not.toThrow();
});

test("a blocker asking for a decision rather than a file is left alone", () => {
  const task = readyTasks().tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const blocked = {
    task_id: task.id,
    status: "blocked" as const,
    summary: "Needs a product decision",
    blocker: {
      reason: "Whether duplicate emails are allowed is not specified",
      required_files: [],
      required_decision: "Decide the duplicate-email behaviour",
    },
    traceability: [],
    changes: [],
  };

  expect(() => validateProposal(blocked, task, [])).not.toThrow();
});

test("a blocker asking for a file a sibling task owns is rejected", () => {
  const task = testOnlyTask();
  const sibling = {
    ...task,
    id: "T3",
    files: { read: [], modify: ["src/store.ts"], create: [] },
  };
  const proposal = blockedOn(["src/store.ts"]);

  // The refusal seen on every test-first run: the test cannot call a function that does not exist,
  // so the task asks to write the implementation itself — which is the accepted plan undone.
  expect(() => validateProposal(proposal, task, [], defaultPolicy, [task, sibling])).toThrow(
    "owned by T3",
  );
});

test("a blocker naming a file no task owns is a real answer", () => {
  const task = testOnlyTask();
  const proposal = blockedOn(["src/migrations/001.sql"]);

  expect(() => validateProposal(proposal, task, [], defaultPolicy, [task])).not.toThrow();
});

test("a blocker naming both an owned and an unowned file still stands", () => {
  const task = testOnlyTask();
  const sibling = { ...task, id: "T3", files: { read: [], modify: ["src/store.ts"], create: [] } };
  const proposal = blockedOn(["src/store.ts", "config/secrets.yaml"]);

  // Only a refusal the graph fully answers is wrong; a partial one may still be reporting a gap.
  expect(() => validateProposal(proposal, task, [], defaultPolicy, [task, sibling])).not.toThrow();
});

function testOnlyTask(): Task {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return {
    ...first,
    id: "T1",
    requirements: ["R1"],
    acceptance: [],
    files: { read: ["src/store.ts"], modify: ["src/store.test.ts"], create: [] },
  };
}

function blockedOn(required: string[]): ChangeProposal {
  return {
    task_id: "T1",
    status: "blocked",
    summary: "Cannot write the test",
    blocker: {
      reason: "The function under test does not exist yet",
      required_files: required,
      required_decision: "Allow this task to write the implementation",
    },
    traceability: [],
    changes: [],
  };
}

test("tracing a criterion to a file the proposal only reads is explained, not just refused", () => {
  const task = testOnlyTask();
  const files = [{ path: "src/store.test.ts", content: "old\n", sha256: sha256("old\n") }];
  const proposal: ChangeProposal = {
    task_id: "T1",
    status: "ready",
    summary: "Add tag tests",
    blocker: null,
    // The commonest wrong guess: point at the source under test rather than the file changed.
    traceability: [
      { covers: "R1", paths: ["src/store.test.ts"] },
      { covers: "A1", paths: ["src/store.ts"] },
    ],
    changes: [
      {
        path: "src/store.test.ts",
        operation: "modify",
        expected_sha256: sha256("old\n"),
        content: "new\n",
      },
    ],
  };

  expect(() =>
    validateProposal({ ...proposal }, { ...task, acceptance: ["A1"] }, files, defaultPolicy),
  ).toThrow("traces A1 to src/store.ts, which this proposal does not change");
});

test("a missing traceability entry says which criterion and what to point at", () => {
  const task = testOnlyTask();
  const files = [{ path: "src/store.test.ts", content: "old\n", sha256: sha256("old\n") }];
  const proposal: ChangeProposal = {
    task_id: "T1",
    status: "ready",
    summary: "Add tag tests",
    blocker: null,
    traceability: [{ covers: "R1", paths: ["src/store.test.ts"] }],
    changes: [
      {
        path: "src/store.test.ts",
        operation: "modify",
        expected_sha256: sha256("old\n"),
        content: "new\n",
      },
    ],
  };

  expect(() =>
    validateProposal(proposal, { ...task, acceptance: ["A1"] }, files, defaultPolicy),
  ).toThrow("no traceability entry for A1");
});
