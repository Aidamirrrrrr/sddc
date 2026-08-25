import { afterEach, expect, test } from "bun:test";
import { currentTheme, detectTheme, setTheme, theme } from "./theme";

afterEach(() => setTheme("dark"));

test("a true-colour dark terminal gets the full palette", () => {
  expect(detectTheme({ COLORTERM: "truecolor" })).toBe("dark");
  expect(detectTheme({ COLORTERM: "24bit", COLORFGBG: "15;0" })).toBe("dark");
});

test("a light terminal is detected from COLORFGBG", () => {
  // "foreground;background": a high background number is a light terminal.
  expect(detectTheme({ COLORTERM: "truecolor", COLORFGBG: "0;15" })).toBe("light");
});

test("a terminal that never claimed true colour is not given hex", () => {
  // Painting hex surfaces onto a 16-colour SSH session renders as mud.
  expect(detectTheme({})).toBe("ansi");
  expect(detectTheme({ TERM: "xterm-256color" })).toBe("ansi");
  expect(detectTheme({ COLORTERM: "truecolor", NO_COLOR: "1" })).toBe("ansi");
});

test("an explicit choice beats every hint", () => {
  expect(detectTheme({ SDDC_THEME: "light", NO_COLOR: "1" })).toBe("light");
  expect(detectTheme({ SDDC_THEME: "nonsense", COLORTERM: "truecolor" })).toBe("dark");
});

test("colours are read at render time, not at import time", () => {
  // Every call site holds this one object, so switching has to reach all of them.
  const dark = theme.text;
  setTheme("light");

  expect(theme.text).not.toBe(dark);
  expect(currentTheme()).toBe("light");
});

test("the ansi palette names colours rather than spelling them in hex", () => {
  setTheme("ansi");

  expect(theme.danger).toBe("red");
  expect(theme.text).toBe("white");
});
