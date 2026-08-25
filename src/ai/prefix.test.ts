import { expect, test } from "bun:test";
import { taskPrompts } from "../tasks/prompts";
import { composePrompt, PREAMBLE } from "./model-client";

function sharedPrefix(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

/** Mirrors how a phase grows its context: each stage appends its predecessor's output. */
function phaseContext(extra: Record<string, unknown> = {}): string {
  const base = {
    outputLanguage: "en",
    specification: { goal: "Register users", detail: "x".repeat(4000) },
    plan: { summary: "Two steps" },
    approvedSnapshots: [{ path: "src/auth.ts", content: "y".repeat(4000) }],
  };
  return JSON.stringify({ ...base, ...extra }, null, 2);
}

test("the stage instruction stays out of the shared prefix", () => {
  const prompt = composePrompt(taskPrompts.audit, phaseContext());

  // The instruction must trail the context, never lead it.
  expect(prompt.startsWith("{")).toBe(true);
  expect(prompt.endsWith(taskPrompts.audit)).toBe(true);
  // And it must not be smuggled into the system message, which would diverge at token zero.
  expect(PREAMBLE).not.toContain(taskPrompts.audit);
  expect(PREAMBLE).not.toContain(taskPrompts.draft);
});

test("consecutive stages of a phase share almost their whole prompt prefix", () => {
  const draft = composePrompt(taskPrompts.draft, phaseContext());
  const audit = composePrompt(taskPrompts.audit, phaseContext({ draft: { tasks: [] } }));

  const shared = sharedPrefix(draft, audit);

  // The shared run covers the context, not merely a few leading characters.
  expect(shared).toBeGreaterThan(8000);
  expect(shared / Math.min(draft.length, audit.length)).toBeGreaterThan(0.9);
});

test("a different phase context does not accidentally share a prefix", () => {
  const first = composePrompt(taskPrompts.draft, phaseContext());
  const other = composePrompt(taskPrompts.draft, JSON.stringify({ outputLanguage: "ru" }, null, 2));

  expect(sharedPrefix(first, other)).toBeLessThan(100);
});
