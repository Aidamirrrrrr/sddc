import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSession, hasRecordedAnswers, loadSession, phaseState, saveSession } from "./session";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sddc-session-"));
}

test("recorded answers survive a failed stage and are replayed into the same request", async () => {
  const root = await workspace();
  await saveSession(root, "add registration", "tasks", {
    input: "Q1: run pnpm build inside the auth module\n",
    clarification_rounds: 1,
    revision_rounds: 0,
  });

  const session = await loadSession(root, "add registration");

  expect(hasRecordedAnswers(session)).toBe(true);
  expect(phaseState(session, "tasks").input).toContain("pnpm build");
  expect(phaseState(session, "tasks").clarification_rounds).toBe(1);
  expect(phaseState(session, "plan")).toEqual({
    input: "",
    clarification_rounds: 0,
    revision_rounds: 0,
  });
});

test("answers from a different request are never replayed", async () => {
  const root = await workspace();
  await saveSession(root, "add registration", "spec", {
    input: "Q1: email only\n",
    clarification_rounds: 1,
    revision_rounds: 0,
  });

  expect(await loadSession(root, "add billing")).toBeUndefined();
});

test("saving one phase preserves the answers of the others", async () => {
  const root = await workspace();
  const state = { input: "spec answer\n", clarification_rounds: 1, revision_rounds: 0 };
  await saveSession(root, "request", "spec", state);
  await saveSession(root, "request", "tasks", {
    input: "task answer\n",
    clarification_rounds: 1,
    revision_rounds: 0,
  });

  const session = await loadSession(root, "request");

  expect(phaseState(session, "spec").input).toBe("spec answer\n");
  expect(phaseState(session, "tasks").input).toBe("task answer\n");
});

test("a completed feature clears the conversation", async () => {
  const root = await workspace();
  await saveSession(root, "request", "spec", {
    input: "answer\n",
    clarification_rounds: 1,
    revision_rounds: 0,
  });

  await clearSession(root);

  expect(await loadSession(root, "request")).toBeUndefined();
  // Clearing an already clean workspace is a no-op rather than a failure.
  await clearSession(root);
});
