import { expect, test } from "bun:test";
import { compileGitignore } from "./gitignore";

test("a bare name is ignored at any depth, together with what is under it", () => {
  const ignored = compileGitignore("node_modules\ndist\n");

  expect(ignored("node_modules", true)).toBe(true);
  expect(ignored("packages/web/node_modules", true)).toBe(true);
  expect(ignored("dist/app.js", false)).toBe(true);
  expect(ignored("src/dist-helper.ts", false)).toBe(false);
});

test("a leading slash anchors the pattern to the root", () => {
  const ignored = compileGitignore("/build\n");

  expect(ignored("build", true)).toBe(true);
  expect(ignored("packages/web/build", true)).toBe(false);
});

test("a trailing slash matches directories only", () => {
  const ignored = compileGitignore("cache/\n");

  expect(ignored("cache", true)).toBe(true);
  // A file that happens to be called cache is not what the rule was written about.
  expect(ignored("cache", false)).toBe(false);
});

test("stars stay inside a segment and double stars cross them", () => {
  const ignored = compileGitignore("*.log\n**/generated\n");

  expect(ignored("server.log", false)).toBe(true);
  expect(ignored("logs/server.log", false)).toBe(true);
  expect(ignored("src/deep/generated", true)).toBe(true);
  // `**/` matches nothing at all as well, so a root-level one is caught too.
  expect(ignored("generated", true)).toBe(true);
});

test("a later negation re-includes what an earlier rule took", () => {
  const ignored = compileGitignore("*.log\n!keep.log\n");

  expect(ignored("server.log", false)).toBe(true);
  expect(ignored("keep.log", false)).toBe(false);
});

test("comments and blank lines say nothing", () => {
  const ignored = compileGitignore("# build output\n\n   \ndist\n");

  expect(ignored("dist", true)).toBe(true);
  expect(ignored("build", true)).toBe(false);
});
