import { expect, test } from "bun:test";
import { looksLikeDiff } from "./Panel";

test("a unified diff is recognised by its header pair", () => {
  expect(looksLikeDiff("--- a/src/store.ts\n+++ b/src/store.ts\n-old line\n+new line")).toBe(true);
});

test("prose that merely starts lines with a dash is not a diff", () => {
  // Colouring a bullet list as deletions is worse than leaving a diff grey, so the decision is
  // made for the whole body rather than line by line.
  const notes = "Risks:\n- The signature change may break callers\n- The tag is optional\n+1 more";

  expect(looksLikeDiff(notes)).toBe(false);
});

test("a diff further down a document is still found", () => {
  const body = "R1 → src/store.ts\n\n--- a/src/store.ts\n+++ b/src/store.ts\n+added";

  expect(looksLikeDiff(body)).toBe(true);
});
