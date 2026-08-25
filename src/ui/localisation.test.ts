import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every file under these roots draws the surface, so every word in them is read by a person. */
const ROOTS = ["src/ui", "src/cli"];

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(path) || path.includes(".test.")) return [];
    return [path];
  });
}

test("nothing on the surface is written in only one language", () => {
  // Half a surface in one language and half in the other is what this catches: a literal handed
  // straight to a component or a hint, rather than through `t` or `phrase`.
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      const source = readFileSync(file, "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        // A <Hint> or placeholder holding a bare English sentence is the shape that slipped through.
        const bare = line.match(/<Hint>([A-Za-z][^<{]{6,})<\/Hint>/);
        if (bare) offenders.push(`${file}:${index + 1} ${bare[1]?.trim()}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test("the copy helper is the only way a surface picks a word", () => {
  // Two implementations of "which language" is how they drift apart; cli/ui delegates rather than
  // keeping its own flag.
  const cliUi = readFileSync("src/cli/ui.ts", "utf8");

  expect(cliUi).not.toMatch(/let russian/);
  expect(cliUi).toContain('from "../ui/language"');
});
