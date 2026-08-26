import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicy } from "../policy/load";
import type { Task } from "../tasks/schemas";
import { readyTasks } from "../tasks/test-fixtures";
import { restoreFiles } from "./files";
import { createToolHost, isDeclaredCommand, type ToolCall, validateToolCall } from "./tools";

const blank: ToolCall = {
  reasoning: "",
  tool: "read",
  read: null,
  search: null,
  write: null,
  run: null,
  finish: null,
  block: null,
};

function call(partial: Partial<ToolCall>): ToolCall {
  return { ...blank, ...partial };
}

function task(): Task {
  const [first] = readyTasks().tasks;
  if (!first) throw new Error("Fixture must contain a task");
  return {
    ...first,
    acceptance: [],
    requirements: ["R1"],
    files: { read: [], modify: ["src/auth.ts"], create: ["src/new.ts"] },
    verification: [{ command: { program: "bun", args: ["test"] }, purpose: "Suite" }],
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sddc-tools-"));
  await Bun.write(join(root, "src/auth.ts"), "original\n");
  await Bun.write(join(root, "src/format.ts"), "export const shape = 42;\n");
  await Bun.write(join(root, ".env"), "SECRET=nope\n");
  return root;
}

function host(root: string, extra = {}) {
  return createToolHost({ root, task: task(), policy: defaultPolicy, ...extra });
}

test("a call must carry exactly the payload it names", () => {
  expect(() => validateToolCall(call({ tool: "write", write: null }))).toThrow(
    "carries no write payload",
  );
  expect(() =>
    validateToolCall(
      call({
        tool: "write",
        write: { path: "a", content: "b" },
        run: { program: "bun", args: [] },
      }),
    ),
  ).toThrow("payloads at once");
  expect(() => validateToolCall(call({ tool: "run", write: { path: "a", content: "b" } }))).toThrow(
    "They must agree",
  );
  expect(() =>
    validateToolCall(call({ tool: "write", write: { path: "a", content: "b" } })),
  ).not.toThrow();
});

test("a write outside the approved scope never reaches the disk", async () => {
  const root = await workspace();

  const outcome = await host(root).execute(
    call({ tool: "write", write: { path: "src/format.ts", content: "hijacked\n" } }),
  );

  // Refused at the moment of the write, not at the end: a model that learns this now corrects its
  // next call, while one that learns it at finish has already built everything on top of it.
  expect(outcome.kind).toBe("continue");
  if (outcome.kind !== "continue") return;
  expect(outcome.result.ok).toBe(false);
  expect(outcome.result.detail).toContain("not one of this task's files");
  expect(await Bun.file(join(root, "src/format.ts")).text()).toBe("export const shape = 42;\n");
});

test("a write inside scope lands and can be rolled back exactly", async () => {
  const root = await workspace();
  const tools = host(root);

  await tools.execute(
    call({ tool: "write", write: { path: "src/auth.ts", content: "changed\n" } }),
  );
  await tools.execute(call({ tool: "write", write: { path: "src/new.ts", content: "made\n" } }));
  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("changed\n");

  await restoreFiles(root, tools.backup());

  expect(await Bun.file(join(root, "src/auth.ts")).text()).toBe("original\n");
  expect(await Bun.file(join(root, "src/new.ts")).exists()).toBe(false);
});

test("finish reports the pre-task hash, not the state a later write left", async () => {
  const root = await workspace();
  const tools = host(root);

  await tools.execute(call({ tool: "write", write: { path: "src/auth.ts", content: "first\n" } }));
  await tools.execute(call({ tool: "write", write: { path: "src/auth.ts", content: "second\n" } }));
  const outcome = await tools.execute(
    call({
      tool: "finish",
      finish: { summary: "done", traceability: [{ covers: "R1", paths: ["src/auth.ts"] }] },
    }),
  );

  expect(outcome.kind).toBe("finish");
  if (outcome.kind !== "finish") return;
  const [change] = outcome.proposal.changes;
  // What validateProposal compares against is the state the task started from. Reporting the state
  // an earlier write in this same loop left would make the check compare the task with itself.
  expect(change?.content).toBe("second\n");
  expect(change?.expected_sha256).toBe(
    new Bun.CryptoHasher("sha256").update("original\n").digest("hex"),
  );
});

test("reading is granted by the host, under the rules the graph was held to", async () => {
  const root = await workspace();
  const tools = host(root);

  const granted = await tools.execute(
    call({ tool: "read", read: { reason: "need the shape", paths: ["src/format.ts"] } }),
  );
  const refused = await tools.execute(
    call({ tool: "read", read: { reason: "curious", paths: [".env"] } }),
  );

  expect(granted.kind === "continue" && granted.result.ok).toBe(true);
  expect(tools.opened().map((file) => file.path)).toEqual(["src/format.ts"]);
  expect(refused.kind === "continue" && refused.result.ok).toBe(false);
  expect(tools.opened().map((file) => file.path)).not.toContain(".env");
});

test("search finds a symbol and never leaves the project", async () => {
  const root = await workspace();

  const outcome = await host(root).execute(
    call({ tool: "search", search: { needle: "shape", glob: "src/**" } }),
  );

  expect(outcome.kind === "continue" && outcome.result.ok).toBe(true);
  if (outcome.kind !== "continue") return;
  expect(outcome.result.detail).toContain("src/format.ts:1");
});

test("a declared command needs no confirmation; anything else does", () => {
  const item = task();

  // Narrowing a declared command to find out why it failed is the whole reason run exists.
  expect(isDeclaredCommand(item, "bun", ["test"])).toBe(true);
  expect(isDeclaredCommand(item, "bun", ["test", "src/one.test.ts"])).toBe(true);
  // Replacing the arguments the user saw makes it a different command.
  expect(isDeclaredCommand(item, "bun", ["run", "anything.ts"])).toBe(false);
  expect(isDeclaredCommand(item, "node", ["test"])).toBe(false);
});

test("a program outside the policy allowlist is refused", async () => {
  const root = await workspace();

  const outcome = await host(root).execute(
    call({ tool: "run", run: { program: "sh", args: ["-c", "touch escaped"] } }),
  );

  expect(outcome.kind === "continue" && outcome.result.ok).toBe(false);
  expect(await Bun.file(join(root, "escaped")).exists()).toBe(false);
});

test("an undeclared command is confirmed once and refusing it stops the command", async () => {
  const root = await workspace();
  let asked = 0;
  const tools = host(root, {
    approveCommand: async () => {
      asked += 1;
      return false;
    },
  });

  await tools.execute(call({ tool: "run", run: { program: "bun", args: ["-e", "1"] } }));
  await tools.execute(call({ tool: "run", run: { program: "bun", args: ["-e", "2"] } }));

  // Asked once for the task, not once per call: a loop that stops on every diagnostic would make
  // strict mode unusable without making it any stricter.
  expect(asked).toBe(1);
});

test("a declared command runs without asking at all", async () => {
  const root = await workspace();
  let asked = 0;
  const tools = host(root, {
    approveCommand: async () => {
      asked += 1;
      return true;
    },
  });

  await tools.execute(call({ tool: "run", run: { program: "bun", args: ["test", "--help"] } }));

  expect(asked).toBe(0);
});
