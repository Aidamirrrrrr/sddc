import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { runTaskAgent } from "./agent";
import { executionPrompts } from "./prompts";

/**
 * A task's readable set is fixed while the graph is planned, by a model that has not yet watched the
 * verification fail. When the failure names a file outside that set, asking to read it has to be an
 * ordinary move — the alternative was to guess or to block, and blocking ends the whole run.
 */
const policy = (expansions: number) => ({
  ...defaultPolicy,
  execution: {
    ...defaultPolicy.execution,
    max_task_iterations: 2,
    max_context_expansions: expansions,
  },
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-needs-"));
  await Bun.write(join(root, "src/auth.ts"), "original\n");
  // Never in the task's files.read: this is exactly the file the graph did not know to grant.
  await Bun.write(join(root, "src/format.ts"), "export const shape = 42;\n");
  await Bun.write(join(root, ".env"), "SECRET=nope\n");
  await Bun.write(join(root, "suite.ts"), "process.exit(0);\n");
  return root;
}

function task() {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return {
    ...first,
    acceptance: [],
    requirements: ["R1"],
    files: { read: [], modify: ["src/auth.ts"], create: [] },
    verification: [{ command: { program: "bun", args: ["run", "suite.ts"] }, purpose: "Suite" }],
  };
}

/**
 * Asks for `wanted` on the first draw, then writes whatever it can see.
 *
 * `seen` records the file list handed to each draw, which is the only way to check that a granted
 * file actually arrived as context rather than merely being read by the host.
 */
function client(wanted: string[], seen: string[][] = []) {
  let draw = 0;
  return {
    seen,
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      if (system !== executionPrompts.implement) {
        return {
          checks: Array.from({ length: 7 }, (_, index) => ({
            id: `E${index + 1}`,
            passed: true,
            finding: "Passed",
          })),
          findings: [],
        } as T;
      }
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      const files = context.files as Array<{ path: string; sha256: string; content: string }>;
      seen.push(files.map((file) => file.path));
      draw += 1;
      if (draw === 1) {
        return {
          task_id: context.task.id,
          status: "needs_files",
          summary: "I need to see what I am calling",
          blocker: null,
          needs_files: {
            reason: "The change has to match an existing signature",
            paths: wanted.map((path) => ({ path, reason: "referenced by the change" })),
          },
          traceability: [],
          changes: [],
        } as T;
      }
      const target = files.find((file) => file.path === "src/auth.ts");
      const granted = files.find((file) => file.path === "src/format.ts");
      return {
        task_id: context.task.id,
        status: "ready",
        summary: "Change src/auth.ts",
        blocker: null,
        needs_files: null,
        traceability: [{ covers: "R1", paths: ["src/auth.ts"] }],
        changes: [
          {
            path: "src/auth.ts",
            operation: "modify",
            expected_sha256: target?.sha256,
            content: granted ? `saw ${granted.content.trim()}\n` : "saw nothing\n",
          },
        ],
      } as T;
    },
  };
}

function run(root: string, model: ReturnType<typeof client>, expansions = 2, extra = {}) {
  return runTaskAgent({
    client: model,
    root,
    spec: readySpec(),
    plan: readyPlan(),
    task: task(),
    policy: policy(expansions),
    graph: [task()],
    stage: {},
    feedback: "",
    ...extra,
  });
}

test("a requested file arrives as context on the next draw", async () => {
  const root = await workspace();
  const model = client(["src/format.ts"]);

  const outcome = await run(root, model);

  expect(outcome.kind).toBe("settled");
  // The first draw never saw it; the second did. That is the whole mechanism.
  expect(model.seen[0]).not.toContain("src/format.ts");
  expect(model.seen[1]).toContain("src/format.ts");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("saw export const shape = 42;\n");
});

test("a read request never widens what the task may write", async () => {
  const root = await workspace();
  const model = client(["src/format.ts"]);

  const outcome = await run(root, model);

  // Granted for reading, and only for reading: the proposal that follows still writes its own file.
  expect(outcome.kind).toBe("settled");
  if (outcome.kind !== "settled") return;
  expect(outcome.turn.proposal.changes.map((change) => change.path)).toEqual(["src/auth.ts"]);
  expect(await Bun.file(join(root, "src/format.ts")).text()).toBe("export const shape = 42;\n");
});

test("a forbidden path is refused rather than read", async () => {
  const root = await workspace();
  const model = client([".env"]);

  const outcome = await run(root, model);

  // The host decides, and it decides by the same rules the task graph was held to. A refusal is not
  // a failure: the next draw is told why and gets on with the work.
  expect(outcome.kind).toBe("settled");
  expect(model.seen[1]).not.toContain(".env");
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("saw nothing\n");
});

test("a file that does not exist is refused with a reason", async () => {
  const root = await workspace();
  const model = client(["src/imaginary.ts"]);
  const refusals: string[][] = [];

  await run(root, model, 2, {
    onFilesRequested: (_granted: string[], refused: string[]) => refusals.push(refused),
  });

  expect(refusals[0]?.[0]).toContain("does not exist");
});

test("strict mode asks before the task reads anything", async () => {
  const root = await workspace();
  const model = client(["src/format.ts"]);
  let asked = 0;

  await run(root, model, 2, {
    approveFiles: async () => {
      asked += 1;
      return false;
    },
  });

  expect(asked).toBe(1);
  // Refused, so nothing new reached the model even though the path was perfectly legal.
  expect(model.seen[1]).not.toContain("src/format.ts");
});

test("expansions have their own budget and it is enforced", async () => {
  const root = await workspace();
  const model = client(["src/format.ts"]);

  // Zero expansions: the request is answered with a refusal that spends a turn instead.
  const outcome = await run(root, model, 0);

  expect(model.seen).toHaveLength(2);
  expect(model.seen[1]).not.toContain("src/format.ts");
  expect(outcome.kind).toBe("settled");
});
