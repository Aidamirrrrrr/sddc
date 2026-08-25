import { expect, test } from "bun:test";
import type { Choice } from "../driver";
import { filterChoices, nextEnabled, windowAround } from "./prompts";

function choices(...labels: string[]): Choice<string>[] {
  return labels.map((label) => ({ value: label, label }));
}

test("moving through a list wraps at both ends", () => {
  const list = choices("a", "b", "c");

  expect(nextEnabled(list, 0, 1)).toBe(1);
  expect(nextEnabled(list, 2, 1)).toBe(0);
  expect(nextEnabled(list, 0, -1)).toBe(2);
});

test("disabled rows are skipped in the direction of travel", () => {
  const list: Choice<string>[] = [
    { value: "a", label: "a" },
    { value: "b", label: "b", disabled: true },
    { value: "c", label: "c" },
  ];

  expect(nextEnabled(list, 0, 1)).toBe(2);
  expect(nextEnabled(list, 2, -1)).toBe(0);
});

test("a list where every other row is disabled still settles", () => {
  const list: Choice<string>[] = [
    { value: "a", label: "a" },
    { value: "b", label: "b", disabled: true },
  ];

  // Nothing else is selectable, so the cursor stays rather than looping forever.
  expect(nextEnabled(list, 0, 1)).toBe(0);
});

test("a short list is shown whole", () => {
  const list = choices("a", "b", "c");

  expect(windowAround(list, 0, 12)).toEqual(list);
});

test("the window follows the cursor and never runs past either end", () => {
  const list = Array.from({ length: 40 }, (_, index) => index);

  expect(windowAround(list, 0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(windowAround(list, 20, 10)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  // At the end the window stops rather than sliding off and returning a short slice.
  expect(windowAround(list, 39, 10)).toHaveLength(10);
  expect(windowAround(list, 39, 10).at(-1)).toBe(39);
});

test("filtering is case-insensitive and matches anywhere in the label", () => {
  const list = choices("src/Auth.ts", "src/session.ts", "tests/auth.test.ts");

  expect(filterChoices(list, "AUTH").map((item) => item.label)).toEqual([
    "src/Auth.ts",
    "tests/auth.test.ts",
  ]);
  expect(filterChoices(list, "session")).toHaveLength(1);
});

test("an empty or blank filter keeps the whole list", () => {
  const list = choices("a", "b");

  expect(filterChoices(list, "")).toEqual(list);
  expect(filterChoices(list, "   ")).toEqual(list);
});

test("a filter matching nothing yields nothing rather than everything", () => {
  expect(filterChoices(choices("a", "b"), "zzz")).toEqual([]);
});

test("a pasted answer ending in a newline submits instead of swallowing it", () => {
  // Ink delivers a paste as one chunk, so the newline never raises key.return. Appending it as a
  // character left the field unsubmittable — the harness typed the same answer over and over.
  const chunk = "pnpm build in the auth module\r";
  const [typed = "", ...rest] = chunk.split(/\r|\n/);

  expect(typed).toBe("pnpm build in the auth module");
  expect(rest.length > 0).toBe(true);
});

test("a paste without a newline is just text", () => {
  const [typed = "", ...rest] = "half an answer".split(/\r|\n/);

  expect(typed).toBe("half an answer");
  expect(rest.length > 0).toBe(false);
});
