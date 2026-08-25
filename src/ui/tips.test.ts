import { afterEach, expect, test } from "bun:test";
import { setLanguage } from "./language";
import { nextTip, resetTips, tipCount } from "./tips";

afterEach(() => {
  resetTips();
  setLanguage("en");
});

test("nothing repeats until everything has been shown", () => {
  // A plain random pick shows the same line twice in one wait often enough to look broken.
  const seen = Array.from({ length: tipCount() }, () => nextTip());

  expect(new Set(seen).size).toBe(tipCount());
});

test("the cycle refills rather than running dry", () => {
  for (let index = 0; index < tipCount(); index += 1) nextTip();

  expect(nextTip()).not.toBe("");
});

test("a tip is written in the reader's language", () => {
  setLanguage("ru");
  expect(nextTip()).toMatch(/[А-Яа-яЁё]/);

  resetTips();
  setLanguage("en");
  expect(nextTip()).not.toMatch(/[А-Яа-яЁё]/);
});
