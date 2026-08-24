import { describe, expect, test } from "bun:test";
import { parseCli } from "./args";

describe("CLI arguments", () => {
  test("recognizes standalone commands", () => {
    expect(parseCli(["--help"]).help).toBe(true);
    expect(parseCli(["--version"]).version).toBe(true);
    expect(parseCli(["--init"]).init).toBe(true);
  });

  test("keeps arguments after the delimiter as input", () => {
    expect(parseCli(["--", "--thinking", "on"])).toMatchObject({
      thinking: false,
      input: ["--thinking", "on"],
    });
  });
});
