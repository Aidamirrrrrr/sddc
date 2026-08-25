import { afterEach, expect, test } from "bun:test";
import { isInterrupted, resetInterrupt } from "../../ai/interrupt";
import { currentTheme, setTheme } from "../theme";
import { commands, isCommand, matchCommands, runCommand } from "./commands";
import type { AppState } from "./store";

afterEach(() => {
  setTheme("dark");
  resetInterrupt();
});

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    heading: "sddc",
    blocks: [],
    phases: [
      { label: "Choose source access", state: "done" },
      { label: "Agree on requirements", state: "active" },
      { label: "Derive the task graph", state: "pending" },
    ],
    startedAt: Date.now(),
    ...overrides,
  };
}

test("a command is recognised by its leading slash and nothing else", () => {
  expect(isCommand("/help")).toBe(true);
  expect(isCommand("   /help")).toBe(true);
  expect(isCommand("add a tag to notes")).toBe(false);
  expect(isCommand("what does / mean")).toBe(false);
});

test("typing narrows the completions", () => {
  expect(matchCommands("/").length).toBe(commands.length);
  expect(matchCommands("/st").map((command) => command.name)).toEqual(["status", "stop"]);
  expect(matchCommands("/stat").map((command) => command.name)).toEqual(["status"]);
  expect(matchCommands("/zzz")).toEqual([]);
  // Only the command word counts, so an argument does not empty the list.
  expect(matchCommands("/theme light").map((command) => command.name)).toEqual(["theme"]);
});

test("plain text has no completions to offer", () => {
  expect(matchCommands("add a tag")).toEqual([]);
});

test("an unknown command says so instead of failing silently", () => {
  const outcome = runCommand("/nope", { state: state() });

  expect(outcome).toMatchObject({ kind: "line", tone: "warn" });
  if (outcome.kind !== "line") throw new Error("expected a line");
  expect(outcome.text).toContain("/help");
});

test("status reports where the run is and what it cost", () => {
  const outcome = runCommand("/status", { state: state({ stage: "Deriving the task graph" }) });

  if (outcome.kind !== "panel") throw new Error("expected a panel");
  expect(outcome.body).toContain("Phase          1 of 3");
  expect(outcome.body).toContain("Deriving the task graph");
});

test("phases lists the rail as text", () => {
  const outcome = runCommand("/phases", { state: state() });

  if (outcome.kind !== "panel") throw new Error("expected a panel");
  expect(outcome.body).toContain("2. [active] Agree on requirements");
});

test("theme switches the palette, and refuses a name it does not have", () => {
  expect(runCommand("/theme light", { state: state() })).toMatchObject({ tone: "success" });
  expect(currentTheme()).toBe("light");

  expect(runCommand("/theme neon", { state: state() })).toMatchObject({ tone: "warn" });
  // The bad argument left the good choice standing rather than resetting it.
  expect(currentTheme()).toBe("light");
});

test("stop asks the run to stop", () => {
  expect(isInterrupted()).toBe(false);

  runCommand("/stop", { state: state() });

  expect(isInterrupted()).toBe(true);
});

test("help lists every command, including itself", () => {
  const outcome = runCommand("/help", { state: state() });

  if (outcome.kind !== "panel") throw new Error("expected a panel");
  for (const command of commands) expect(outcome.body).toContain(`/${command.name}`);
});
