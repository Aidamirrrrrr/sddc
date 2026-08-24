import { afterEach, expect, test } from "bun:test";
import { phrase, setUiLanguage } from "./ui";

afterEach(() => setUiLanguage("English"));

test("UI follows the detected request language", () => {
  const copy = { en: "Answer", ru: "Ответ" };
  setUiLanguage("ru");
  expect(phrase(copy)).toBe("Ответ");
  setUiLanguage("English");
  expect(phrase(copy)).toBe("Answer");
});
