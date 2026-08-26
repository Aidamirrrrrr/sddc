import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readyPlan, readySpec } from "../planning/test-fixtures";
import { defaultPolicy } from "../policy/load";
import { readyTasks } from "../tasks/test-fixtures";
import { runTaskTools, summarize } from "./pipeline";
import { executionPrompts } from "./prompts";
import type { ToolCall, ToolResult } from "./tools";

const blank: ToolCall = {
  reasoning: "",
  tool: "finish",
  read: null,
  search: null,
  write: null,
  run: null,
  finish: null,
  block: null,
};

function write(path: string, content: string): ToolCall {
  return { ...blank, tool: "write", write: { path, content } };
}

function finish(traceability: Array<{ covers: string; paths: string[] }>): ToolCall {
  return { ...blank, tool: "finish", finish: { summary: "done", traceability } };
}

/** Replays a script of tool calls and records what the loop showed the model each time. */
function scripted(calls: ToolCall[]) {
  const prompts: string[] = [];
  return {
    prompts,
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
      prompts.push(prompt);
      const next = calls.shift();
      if (!next) throw new Error("Script ran out of tool calls");
      return next as T;
    },
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-loop-"));
  await Bun.write(join(root, "src/auth.ts"), "old\n");
  return root;
}

function task() {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return { ...first, requirements: ["R1"], acceptance: ["A1"] };
}

test("a rejected finish comes back as evidence and the loop corrects it", async () => {
  const root = await workspace();
  const client = scripted([
    write("src/auth.ts", "new\n"),
    // Traces a criterion to a file this proposal does not change, which the validator refuses.
    finish([
      { covers: "R1", paths: ["src/auth.ts"] },
      { covers: "A1", paths: ["src/elsewhere.ts"] },
    ]),
    finish([
      { covers: "R1", paths: ["src/auth.ts"] },
      { covers: "A1", paths: ["src/auth.ts"] },
    ]),
  ]);

  const attempt = await runTaskTools(client, root, readySpec(), readyPlan(), task());

  expect(attempt.proposal.status).toBe("ready");
  // The validator's message is written to be acted on, so it goes back as the next call's evidence
  // rather than ending the attempt. A one-shot draw could only be redrawn whole.
  expect(client.prompts[2]).toContain("which this proposal does not change");
  expect(attempt.proposal.changes).toHaveLength(1);
});

test("the loop keeps only what the workspace actually got", async () => {
  const root = await workspace();
  const client = scripted([
    // Refused at the write, so it must not appear among the changes at the end.
    write("src/forbidden.ts", "nope\n"),
    write("src/auth.ts", "new\n"),
    finish([
      { covers: "R1", paths: ["src/auth.ts"] },
      { covers: "A1", paths: ["src/auth.ts"] },
    ]),
  ]);

  const attempt = await runTaskTools(client, root, readySpec(), readyPlan(), task());

  expect(attempt.proposal.changes.map((change) => change.path)).toEqual(["src/auth.ts"]);
  expect(await Bun.file(join(root, "src/forbidden.ts")).exists()).toBe(false);
});

test("a task that never finishes ends as an error, not as a silent success", async () => {
  const root = await workspace();
  const policy = {
    ...defaultPolicy,
    execution: { ...defaultPolicy.execution, max_tool_calls_per_task: 3 },
  };
  const client = scripted([
    write("src/auth.ts", "one\n"),
    write("src/auth.ts", "two\n"),
    write("src/auth.ts", "three\n"),
  ]);

  await expect(
    runTaskTools(client, root, readySpec(), readyPlan(), task(), "", policy),
  ).rejects.toThrow("used all 3 tool calls");
});

test("the transcript keeps recent results whole and collapses the rest", () => {
  const results: ToolResult[] = Array.from({ length: 5 }, (_, index) => ({
    tool: "run",
    ok: true,
    summary: `line ${index}`,
    detail: `the whole output of ${index}`,
  }));

  const kept = summarize(results, 2) as Array<{ output: string }>;

  // Without this the transcript is the one thing in the pipeline that grows without limit inside a
  // single task.
  expect(kept[0]?.output).toBe("line 0");
  expect(kept[2]?.output).toBe("line 2");
  expect(kept[3]?.output).toBe("the whole output of 3");
  expect(kept[4]?.output).toBe("the whole output of 4");
});
