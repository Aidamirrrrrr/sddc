import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const componentsThatReadKeys = ["App.tsx", "CommandLine.tsx", "prompts.tsx"];

test("no component calls ink's useInput directly", () => {
  // It throws from render when stdin cannot enter raw mode, which takes the whole frame down rather
  // than merely disabling a key — a non-TTY preview of the surface is what found this.
  for (const file of componentsThatReadKeys) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source).not.toContain("useInput(");
    expect(source).toContain("useKeys(");
  }
});
