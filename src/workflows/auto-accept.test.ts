import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { defaultPolicy } from "../policy/load";
import type { Driver } from "../ui/driver";
import { setDriver } from "../ui/driver";
import { converge } from "./dialogue";

/**
 * Everything reaching the review menu has already passed every validator, so "it is valid" is not a
 * signal — treating it as one would delete the review rather than shorten it. What is a signal is
 * that the phase never had to ask a question and was never sent back.
 */
type Artifact = {
  status: string;
  questions: Array<{ id: string; question: string; reason: string }>;
};

function silentDriver(overrides: Partial<Driver> = {}): Driver {
  const nothing = () => undefined;
  return {
    begin: nothing,
    banner: nothing,
    finish: nothing,
    info: nothing,
    success: nothing,
    warn: nothing,
    step: nothing,
    document: nothing,
    action: nothing,
    async stage(_labels, operation) {
      return operation();
    },
    async select() {
      throw new Error("select should not be reached");
    },
    async multiselect() {
      throw new Error("multiselect should not be reached");
    },
    async confirm() {
      throw new Error("confirm should not be reached");
    },
    async text() {
      throw new Error("text should not be reached");
    },
    cancel() {
      throw new Error("cancelled");
    },
    ...overrides,
  } as Driver;
}

async function run(
  artifact: Artifact,
  overrides: Partial<Driver>,
  policy = defaultPolicy,
): Promise<Artifact> {
  const root = await mkdtemp(`${tmpdir()}/sddc-auto-`);
  setDriver(silentDriver(overrides));
  return converge<Artifact>({
    phase: "spec",
    root,
    request: "add archiving",
    policy,
    initial: { input: "", clarification_rounds: 0, revision_rounds: 0 },
    build: async () => artifact,
    progress: { en: "", ru: "" },
    complete: { en: "", ru: "" },
    title: { en: "Requirements", ru: "Требования" },
    reviewPrompt: { en: "Accept?", ru: "Принять?" },
    revisePrompt: { en: "What?", ru: "Что?" },
    summary: () => "summary",
    details: () => "details",
    render: () => "rendered",
    clarificationHeading: "User clarifications:",
    rejectionHeading: "Rejected:",
  });
}

const ready: Artifact = { status: "ready", questions: [] };

test("an uncontested artifact is accepted when the countdown runs out", async () => {
  let asked = 0;

  const value = await run(ready, {
    async autoAccept() {
      asked += 1;
      return true;
    },
  });

  expect(asked).toBe(1);
  expect(value.status).toBe("ready");
});

test("a keystroke during the countdown hands the artifact back to the review menu", async () => {
  const chosen: string[] = [];

  await run(ready, {
    async autoAccept() {
      return false;
    },
    async select(_message, choices) {
      chosen.push(choices.map((choice) => choice.value).join(","));
      return "accept" as never;
    },
  });

  // Stopping the countdown must cost nothing: the ordinary menu opens, with everything on it.
  expect(chosen[0]).toContain("revise");
});

test("a phase that had to be revised is never auto-accepted", async () => {
  let asked = 0;
  const root = await mkdtemp(`${tmpdir()}/sddc-auto-`);
  setDriver(
    silentDriver({
      async autoAccept() {
        asked += 1;
        return true;
      },
      async select() {
        return "accept" as never;
      },
    }),
  );

  await converge<Artifact>({
    phase: "spec",
    root,
    request: "add archiving",
    policy: defaultPolicy,
    // The user already sent this phase back once. Their next approval carries information.
    initial: { input: "feedback", clarification_rounds: 0, revision_rounds: 1 },
    build: async () => ready,
    progress: { en: "", ru: "" },
    complete: { en: "", ru: "" },
    title: { en: "Requirements", ru: "Требования" },
    reviewPrompt: { en: "Accept?", ru: "Принять?" },
    revisePrompt: { en: "What?", ru: "Что?" },
    summary: () => "summary",
    details: () => "details",
    render: () => "rendered",
    clarificationHeading: "User clarifications:",
    rejectionHeading: "Rejected:",
  });

  expect(asked).toBe(0);
});

test("zero seconds turns it off entirely", async () => {
  let asked = 0;
  const off = {
    ...defaultPolicy,
    dialogue: { ...defaultPolicy.dialogue, auto_accept_seconds: 0 },
  };

  await run(
    ready,
    {
      async autoAccept() {
        asked += 1;
        return true;
      },
      async select() {
        return "accept" as never;
      },
    },
    off,
  );

  expect(asked).toBe(0);
});

test("a surface that cannot read a key falls through to asking properly", async () => {
  let selected = 0;

  await run(ready, {
    async select() {
      selected += 1;
      return "accept" as never;
    },
  });

  expect(selected).toBe(1);
});
