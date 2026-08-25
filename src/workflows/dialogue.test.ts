import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicy } from "../policy/load";
import type { Driver } from "../ui/driver";
import { setDriver } from "../ui/driver";
import { converge } from "./dialogue";
import { loadSession, phaseState } from "./session";

type Artifact = {
  status: string;
  questions: Array<{ id: string; question: string; reason: string }>;
};

/** Scripts the surface so the loop can be driven without a terminal. */
function scriptedDriver(answers: string[], decisions: string[]): Driver {
  return {
    begin: () => {},
    finish: () => {},
    info: () => {},
    success: () => {},
    warn: () => {},
    step: () => {},
    document: () => {},
    stage: async (_labels, operation) => operation(),
    select: async () => (decisions.shift() ?? "accept") as never,
    multiselect: async () => [] as never,
    confirm: async () => true,
    text: async () => answers.shift() ?? "",
    cancel: () => {
      throw new Error("cancelled");
    },
  };
}

function options(root: string, build: (input: string) => Promise<Artifact>) {
  return {
    phase: "tasks" as const,
    root,
    request: "add registration",
    policy: defaultPolicy,
    initial: { input: "", clarification_rounds: 0, revision_rounds: 0 },
    build,
    progress: { en: "", ru: "" },
    complete: { en: "", ru: "" },
    title: { en: "", ru: "" },
    reviewPrompt: { en: "", ru: "" },
    revisePrompt: { en: "", ru: "" },
    summary: () => "",
    details: () => "",
    render: () => "rendered",
    clarificationHeading: "User task clarifications:",
    rejectionHeading: "Rejected task graph:",
  };
}

test("an answered clarification is persisted before the next stage runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-dialogue-"));
  setDriver(scriptedDriver(["run pnpm build in the auth module"], []));
  const seen: string[] = [];

  await converge(
    options(root, async (input) => {
      seen.push(input);
      return input.includes("pnpm build")
        ? { status: "ready", questions: [] }
        : {
            status: "needs_clarification",
            questions: [{ id: "Q1", question: "How is the build run?", reason: "unclear" }],
          };
    }),
  );

  expect(seen[0]).toBe("");
  expect(seen[1]).toContain("Q1: run pnpm build in the auth module");
  const stored = phaseState(await loadSession(root, "add registration"), "tasks");
  expect(stored.input).toContain("pnpm build");
  expect(stored.clarification_rounds).toBe(1);
});

test("a model that keeps asking is stopped by the clarification limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-dialogue-"));
  setDriver(scriptedDriver(["a", "b", "c", "d", "e"], []));
  let calls = 0;

  const attempt = converge(
    options(root, async () => {
      calls += 1;
      return {
        status: "needs_clarification",
        questions: [{ id: "Q1", question: "again?", reason: "still unclear" }],
      };
    }),
  );

  expect(attempt).rejects.toThrow("still needs clarification after 3 rounds");
  expect(calls).toBeLessThanOrEqual(defaultPolicy.dialogue.max_clarification_rounds + 1);
});

test("repeated rejection is stopped by the revision limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-dialogue-"));
  setDriver(
    scriptedDriver(
      Array.from({ length: 10 }, () => "change it"),
      Array.from({ length: 10 }, () => "revise"),
    ),
  );

  const attempt = converge(options(root, async () => ({ status: "ready", questions: [] })));

  expect(attempt).rejects.toThrow("revised 5 times without approval");
});

test("an accepted artifact is returned without touching the limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "sddc-dialogue-"));
  setDriver(scriptedDriver([], ["accept"]));

  const result = await converge(options(root, async () => ({ status: "ready", questions: [] })));

  expect(result.status).toBe("ready");
});
