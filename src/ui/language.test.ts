import { afterEach, expect, test } from "bun:test";
import { language, setLanguage, t } from "./language";

afterEach(() => setLanguage("en"));

test("a phrase is answered in the chosen language", () => {
  setLanguage("ru");
  expect(t({ en: "Settings", ru: "Настройки" })).toBe("Настройки");

  setLanguage("en");
  expect(t({ en: "Settings", ru: "Настройки" })).toBe("Settings");
});

test("the language is recognised however it was written down", () => {
  for (const value of ["ru", "RU", "russian", "Русский", "ru-RU"]) {
    setLanguage(value);
    expect(language()).toBe("ru");
  }
  for (const value of ["en", "English", "en-GB", ""]) {
    setLanguage(value);
    expect(language()).toBe("en");
  }
});
