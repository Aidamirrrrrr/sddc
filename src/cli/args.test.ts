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

  test("recognizes interaction and output modes", () => {
    expect(parseCli(["--dry-run", "--plain", "--debug", "--lang", "ru"])).toMatchObject({
      dryRun: true,
      plain: true,
      debug: true,
      language: "ru",
    });
    expect(parseCli(["--json"])).toMatchObject({ json: true, noInput: true });
  });

  test("rejects unknown options", () => {
    expect(() => parseCli(["--wat"])).toThrow("Unknown option: --wat");
    expect(() => parseCli(["--lang", "de"])).toThrow("--lang must be 'en' or 'ru'");
  });
});

test("recompile only accepts known phases", () => {
  expect(parseCli(["--recompile", "tasks", "registration"])).toMatchObject({
    recompile: "tasks",
    input: ["registration"],
  });
  expect(() => parseCli(["--recompile", "everything"])).toThrow(
    "--recompile must be 'plan', 'tasks', or 'execute'",
  );
});
