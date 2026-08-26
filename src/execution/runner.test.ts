import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { readyTasks } from "../tasks/test-fixtures";
import { sha256 } from "./context";
import { executePlan } from "./runner";
import { writeExecutionJournal } from "./storage";

test("failed verification rolls source changes back", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-execution-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  const plan = readyPlan();
  const tasks = readyTasks();
  tasks.tasks = tasks.tasks.slice(0, 1);
  const task = tasks.tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  task.verification = [
    { command: { program: "bun", args: ["-e", "process.exit(7)"] }, purpose: "Fail" },
  ];
  const client = stub([
    {
      task_id: task.id,
      status: "ready",
      summary: "Change auth",
      blocker: null,
      needs_files: null,
      traceability: [
        { covers: "R1", paths: ["src/auth.ts"] },
        { covers: "A1", paths: ["src/auth.ts"] },
      ],
      changes: [
        {
          path: "src/auth.ts",
          operation: "modify",
          expected_sha256: sha256("old\n"),
          content: "new\n",
        },
      ],
    },
    passedReview(),
  ]);

  const journal = await executePlan(client, root, readySpec(), plan, tasks.tasks, {
    async review() {
      return { accepted: true };
    },
    async retryAfterFailure() {
      return false;
    },
  });

  expect(journal.status).toBe("failed");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("old\n");
  expect(await Bun.file(join(root, ".specs/registration/execution.yaml")).exists()).toBe(true);
});

test("verified changes are kept and recorded as completed", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-completed-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  const plan = readyPlan();
  const tasks = readyTasks();
  tasks.tasks = tasks.tasks.slice(0, 1);
  const task = tasks.tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  task.verification = [
    { command: { program: "bun", args: ["-e", "process.exit(0)"] }, purpose: "Pass" },
  ];
  const client = stub([
    {
      task_id: task.id,
      status: "ready",
      summary: "Change auth",
      blocker: null,
      needs_files: null,
      traceability: [
        { covers: "R1", paths: ["src/auth.ts"] },
        { covers: "A1", paths: ["src/auth.ts"] },
      ],
      changes: [
        {
          path: "src/auth.ts",
          operation: "modify",
          expected_sha256: sha256("old\n"),
          content: "new\n",
        },
      ],
    },
    passedReview(),
  ]);

  const journal = await executePlan(client, root, readySpec(), plan, tasks.tasks, {
    async review() {
      return { accepted: true };
    },
    async retryAfterFailure() {
      return false;
    },
  });

  expect(journal.status).toBe("completed");
  expect(journal.tasks[0]?.status).toBe("completed");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("new\n");
});

test("blocked proposals stop without touching source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-blocked-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  const plan = readyPlan();
  const tasks = readyTasks();
  tasks.tasks = tasks.tasks.slice(0, 1);
  const task = tasks.tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  const client = stub([
    {
      task_id: task.id,
      status: "blocked",
      summary: "Repository method is missing",
      blocker: {
        reason: "A repository file is outside scope",
        required_files: ["src/repository.ts"],
        required_decision: null,
      },
      traceability: [],
      changes: [],
    },
  ]);

  const journal = await executePlan(client, root, readySpec(), plan, tasks.tasks, {
    async review() {
      return { accepted: true };
    },
    async retryAfterFailure() {
      return false;
    },
  });

  expect(journal.status).toBe("blocked");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("old\n");
});

test("resume skips completed tasks after validating output hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-resume-"));
  await Bun.write(join(root, "src/auth.ts"), "implemented\n");
  const plan = readyPlan();
  const tasks = readyTasks();
  await writeExecutionJournal(root, {
    feature: plan.feature,
    status: "in_progress",
    mode: "normal",
    pending_feedback: null,
    tasks: [
      {
        task_id: "T1",
        status: "completed",
        changed_files: ["src/auth.ts"],
        verification: [],
        output_hashes: [{ path: "src/auth.ts", sha256: sha256("implemented\n") }],
        checkpoint: null,
      },
    ],
  });
  const client = stub([
    {
      task_id: "T2",
      status: "ready",
      summary: "Add tests",
      blocker: null,
      needs_files: null,
      traceability: [
        { covers: "R1", paths: ["src/auth.test.ts"] },
        { covers: "A1", paths: ["src/auth.test.ts"] },
      ],
      changes: [
        {
          path: "src/auth.test.ts",
          operation: "create",
          expected_sha256: null,
          content: "test('registration', () => {});\n",
        },
      ],
    },
    passedReview(),
  ]);
  const secondTask = tasks.tasks[1];
  if (!secondTask) throw new Error("Fixture must contain a second task");
  secondTask.verification = [
    { command: { program: "bun", args: ["-e", "process.exit(0)"] }, purpose: "Pass" },
  ];

  const journal = await executePlan(client, root, readySpec(), plan, tasks.tasks, {
    async review() {
      return { accepted: true };
    },
    async retryAfterFailure() {
      return false;
    },
    async resumeExisting() {
      return true;
    },
  });

  expect(journal.status).toBe("completed");
  expect(journal.tasks.map((task) => task.task_id)).toEqual(["T1", "T2"]);
});

test("final review rolls a task back and requests a revised proposal", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-final-review-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  const plan = readyPlan();
  const tasks = singleTaskList();
  const client = stub([proposal("new\n"), passedReview(), proposal("revised\n"), passedReview()]);
  let reviews = 0;

  const journal = await executePlan(client, root, readySpec(), plan, tasks.tasks, {
    async review() {
      return { accepted: true };
    },
    async retryAfterFailure() {
      return false;
    },
    async finalReview() {
      reviews += 1;
      return reviews === 1
        ? { accepted: false, taskId: "T1", feedback: "Use the revised behavior" }
        : { accepted: true };
    },
  });

  expect(journal.status).toBe("completed");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("revised\n");
});

test("disabled checkpoint restores the verified task", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-checkpoint-policy-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");

  await expect(
    executePlan(
      stub([proposal("new\n"), passedReview()]),
      root,
      readySpec(),
      readyPlan(),
      singleTaskList().tasks,
      {
        async review() {
          return { accepted: true };
        },
        async retryAfterFailure() {
          return false;
        },
        async afterTask() {
          return "checkpoint";
        },
      },
    ),
  ).rejects.toThrow("Git checkpoints are disabled");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("old\n");
});

test("resume rejects manually changed completed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-resume-conflict-"));
  await Bun.write(join(root, "src/auth.ts"), "manual change\n");
  const plan = readyPlan();
  const tasks = singleTaskList();
  await writeExecutionJournal(root, {
    feature: plan.feature,
    status: "in_progress",
    mode: "normal",
    pending_feedback: null,
    tasks: [
      {
        task_id: "T1",
        status: "completed",
        changed_files: ["src/auth.ts"],
        verification: [],
        output_hashes: [{ path: "src/auth.ts", sha256: sha256("implemented\n") }],
        checkpoint: null,
      },
    ],
  });

  await expect(
    executePlan(stub([]), root, readySpec(), plan, tasks.tasks, {
      async review() {
        return { accepted: true };
      },
      async retryAfterFailure() {
        return false;
      },
      async resumeExisting() {
        return true;
      },
    }),
  ).rejects.toThrow("Cannot resume: completed file changed");
});

function singleTaskList() {
  const list = readyTasks();
  list.tasks = list.tasks.slice(0, 1);
  const task = list.tasks[0];
  if (!task) throw new Error("Fixture must contain a task");
  task.verification = [
    { command: { program: "bun", args: ["-e", "process.exit(0)"] }, purpose: "Pass" },
  ];
  return list;
}

function proposal(content: string) {
  return {
    task_id: "T1",
    status: "ready",
    summary: "Change auth",
    blocker: null,
    needs_files: null,
    traceability: [
      { covers: "R1", paths: ["src/auth.ts"] },
      { covers: "A1", paths: ["src/auth.ts"] },
    ],
    changes: [
      {
        path: "src/auth.ts",
        operation: "modify",
        expected_sha256: sha256("old\n"),
        content,
      },
    ],
  };
}

function stub(responses: unknown[]) {
  return {
    async generateObject<T>(_system: string, _prompt: string, _schema: z.ZodType<T>): Promise<T> {
      return responses.shift() as T;
    },
  };
}

function passedReview() {
  return {
    checks: Array.from({ length: 7 }, (_, index) => ({
      id: `E${index + 1}`,
      passed: true,
      finding: "Passed",
    })),
    findings: [],
  };
}
