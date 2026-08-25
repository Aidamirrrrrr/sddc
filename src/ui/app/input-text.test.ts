import { expect, test } from "bun:test";
import {
  breakLine,
  continuesLine,
  currentToken,
  matchPaths,
  mentionQuery,
  pasteAction,
  replaceToken,
} from "./input-text";

test("the token is whatever word the cursor is at the end of", () => {
  expect(currentToken("add a tag to src/st")).toBe("src/st");
  expect(currentToken("add a tag ")).toBe("");
  expect(currentToken("")).toBe("");
});

test("@ is a mention only at the start of a word", () => {
  expect(mentionQuery("look at @src/sto")).toBe("src/sto");
  expect(mentionQuery("look at @")).toBe("");
  // Otherwise it is an address, a decorator, a handle — text somebody meant literally.
  expect(mentionQuery("mail me at name@example.com")).toBeUndefined();
  expect(mentionQuery("no mention here")).toBeUndefined();
});

test("a completion replaces the word being typed and nothing before it", () => {
  expect(replaceToken("add a tag to @src/st", "@src/store.ts ")).toBe(
    "add a tag to @src/store.ts ",
  );
  expect(replaceToken("/the", "/theme ")).toBe("/theme ");
});

test("a trailing backslash continues the line", () => {
  expect(continuesLine("first line\\")).toBe(true);
  expect(continuesLine("first line")).toBe(false);
  // An escaped backslash is a backslash the person wanted, not a continuation.
  expect(continuesLine("path C:\\\\")).toBe(false);
  expect(breakLine("first line\\")).toBe("first line\n");
});

test("paths are ranked by how well the name matches, not merely by containing it", () => {
  const paths = [
    "src/legacy/store-adapter.ts",
    "src/store.ts",
    "src/store.test.ts",
    "docs/storage.md",
  ];

  expect(matchPaths(paths, "store")[0]).toBe("src/store.ts");
  expect(matchPaths(paths, "storage")).toEqual(["docs/storage.md"]);
  expect(matchPaths(paths, "zzz")).toEqual([]);
});

test("an empty query offers a first look rather than nothing", () => {
  expect(matchPaths(["a.ts", "b.ts", "c.ts"], "", 2)).toEqual(["a.ts", "b.ts"]);
});

test("a pasted paragraph stays one request instead of becoming six", () => {
  const pasted = "Add an optional tag to a note\nso notes can be filtered by tag";

  // Splitting on every newline turned a pasted paragraph into a submission per line, each one a
  // fragment of what the person actually asked for.
  expect(pasteAction(pasted)).toEqual({ kind: "insert", text: pasted });
});

test("a newline at the very end is the send", () => {
  expect(pasteAction("add a tag\n")).toEqual({ kind: "submit", text: "add a tag" });
  expect(pasteAction("first\nsecond\r\n")).toEqual({ kind: "submit", text: "first\nsecond" });
});

test("ordinary typing is just text", () => {
  expect(pasteAction("a")).toEqual({ kind: "insert", text: "a" });
});
