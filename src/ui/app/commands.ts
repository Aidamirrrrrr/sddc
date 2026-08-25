import { budgetState } from "../../ai/budget";
import { requestInterrupt } from "../../ai/interrupt";
import { formatUsage, sessionUsage } from "../../ai/usage";
import { setTheme, type ThemeName } from "../theme";
import type { AppState, Tone } from "./store";

/**
 * What a command does, and nothing about how it is drawn.
 *
 * Slash commands are the half of the surface that never reaches a model: they are answered from
 * state the process already holds, which is what makes them instant and what makes them testable
 * without a terminal. Handlers return a description of the outcome rather than pushing to a store,
 * so the whole registry can be exercised as plain functions.
 */
export type CommandOutcome =
  | { kind: "line"; tone: Tone; text: string }
  | { kind: "panel"; title: string; body: string }
  | { kind: "quit" };

export type CommandContext = { state: AppState };

export type Command = {
  name: string;
  summary: string;
  /** The argument is whatever followed the command name, trimmed. */
  run(argument: string, context: CommandContext): CommandOutcome;
};

const THEMES = new Set<ThemeName>(["dark", "light", "ansi"]);

export const commands: Command[] = [
  {
    name: "help",
    summary: "List these commands",
    run: () => ({
      kind: "panel",
      title: "Commands",
      body: commands.map((command) => `/${command.name.padEnd(10)} ${command.summary}`).join("\n"),
    }),
  },
  {
    name: "status",
    summary: "What this run has done and cost so far",
    run: (_argument, { state }) => ({
      kind: "panel",
      title: "Run status",
      body: statusReport(state),
    }),
  },
  {
    name: "phases",
    summary: "Where the run is",
    run: (_argument, { state }) => ({
      kind: "panel",
      title: "Phases",
      body:
        state.phases.length === 0
          ? "The run has not reached its first phase yet."
          : state.phases
              .map((phase, index) => `${index + 1}. [${phase.state}] ${phase.label || "…"}`)
              .join("\n"),
    }),
  },
  {
    name: "theme",
    summary: "Switch palette: dark, light or ansi",
    run: (argument) => {
      const name = argument.trim().toLowerCase() as ThemeName;
      if (!THEMES.has(name)) {
        return { kind: "line", tone: "warn", text: "Usage: /theme dark|light|ansi" };
      }
      setTheme(name);
      return { kind: "line", tone: "success", text: `Theme set to ${name}` };
    },
  },
  {
    name: "stop",
    summary: "Interrupt the work in flight",
    run: () => {
      requestInterrupt();
      return { kind: "line", tone: "warn", text: "Interrupting after the current request…" };
    },
  },
  {
    name: "quit",
    summary: "Leave, keeping everything already saved",
    run: () => ({ kind: "quit" }),
  },
];

function statusReport(state: AppState): string {
  const usage = sessionUsage();
  const budget = budgetState();
  const done = state.phases.filter((phase) => phase.state === "done").length;
  const lines = [
    `Elapsed        ${Math.round((Date.now() - state.startedAt) / 1000)}s`,
    `Phase          ${state.phases.length > 0 ? `${done} of ${state.phases.length}` : "not started"}`,
    `Working on     ${state.stage ?? "nothing right now"}`,
    `Model          ${usage.calls === 0 ? "no calls yet" : formatUsage(usage)}`,
  ];
  if (budget) lines.push(`Call budget    ${budget.used} of ${budget.limit}`);
  return lines.join("\n");
}

/** Commands whose name starts with what has been typed, in registry order. */
export function matchCommands(input: string): Command[] {
  if (!input.startsWith("/")) return [];
  const typed = input.slice(1).split(/\s/)[0]?.toLowerCase() ?? "";
  return commands.filter((command) => command.name.startsWith(typed));
}

/** Whether the input is a command at all — anything else belongs to whatever asked for it. */
export function isCommand(input: string): boolean {
  return input.trimStart().startsWith("/");
}

export function runCommand(input: string, context: CommandContext): CommandOutcome {
  const [name = "", ...rest] = input.trim().slice(1).split(/\s+/);
  const command = commands.find((item) => item.name === name.toLowerCase());
  if (!command) {
    return {
      kind: "line",
      tone: "warn",
      text: `Unknown command /${name}. Type /help to see what there is.`,
    };
  }
  return command.run(rest.join(" ").trim(), context);
}
