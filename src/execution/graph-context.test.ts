import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { sha256 } from "./context";
import { buildTaskProposal } from "./pipeline";
import { executionPrompts } from "./prompts";

/** Captures the context a stage was given instead of contacting a model. */
function capturingClient(onContext: (context: Record<string, unknown>) => void) {
  return {
    async generateObject<T>(system: string, prompt: string): Promise<T> {
      const context = JSON.parse(prompt.split("\n\n----- stage instruction -----")[0] ?? "{}");
      if (system === executionPrompts.implement) {
        onContext(context);
        return {
          task_id: "T1",
          status: "ready",
          summary: "Change auth",
          blocker: null,
          traceability: [{ requirement_id: "R1", paths: ["src/auth.ts"] }],
          changes: [
            {
              path: "src/auth.ts",
              operation: "modify",
              expected_sha256: sha256("old\n"),
              content: "new\n",
            },
          ],
        } as T;
      }
      return {
        decision: "pass",
        checks: Array.from({ length: 7 }, (_, index) => ({
          id: `E${index + 1}`,
          passed: true,
          finding: "Passed",
        })),
        findings: [],
      } as T;
    },
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-graph-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  return root;
}

test("a task is shown the rest of the graph, but only as an outline", async () => {
  let captured: Record<string, unknown> = {};
  const graph = readyTasks().tasks;
  const [first] = graph;
  if (!first) throw new Error("Fixture must contain a task");
  first.acceptance = [];

  await buildTaskProposal(
    capturingClient((context) => {
      captured = context;
    }),
    await workspace(),
    readySpec(),
    readyPlan(),
    first,
    "",
    defaultPolicy,
    graph,
  );

  const others = captured.otherTasks as Array<Record<string, unknown>>;
  expect(others.map((item) => item.id)).toEqual(["T2"]);
  expect(others[0]).toMatchObject({ writes: ["src/auth.test.ts"], covers: ["R1", "A1"] });
  // An outline only: no file contents travel with it, so it cannot become a way to widen scope.
  expect(JSON.stringify(others)).not.toContain("content");
});

test("a task never sees itself in the outline", async () => {
  let captured: Record<string, unknown> = {};
  const graph = readyTasks().tasks;
  const [first] = graph;
  if (!first) throw new Error("Fixture must contain a task");
  first.acceptance = [];

  await buildTaskProposal(
    capturingClient((context) => {
      captured = context;
    }),
    await workspace(),
    readySpec(),
    readyPlan(),
    first,
    "",
    defaultPolicy,
    graph,
  );

  expect((captured.otherTasks as Array<{ id: string }>).some((item) => item.id === "T1")).toBe(
    false,
  );
});

test("a lone task simply has no siblings to be told about", async () => {
  let captured: Record<string, unknown> = {};
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  first.acceptance = [];

  await buildTaskProposal(
    capturingClient((context) => {
      captured = context;
    }),
    await workspace(),
    readySpec(),
    readyPlan(),
    first,
    "",
    defaultPolicy,
  );

  expect(captured.otherTasks).toEqual([]);
});
