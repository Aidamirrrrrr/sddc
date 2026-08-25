import { budgetState } from "../../ai/budget";
import { requestInterrupt } from "../../ai/interrupt";
import { formatUsage, sessionUsage } from "../../ai/usage";
import { saveUserSetting } from "../../config/env";
import { language, setLanguage, t } from "../language";
import { currentTheme, setTheme, type ThemeName } from "../theme";
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
  /** Written in the reader's language, like everything else the surface says. */
  summary(): string;
  /** The argument is whatever followed the command name, trimmed. */
  run(argument: string, context: CommandContext): CommandOutcome;
};

/**
 * A preference, remembered.
 *
 * Writing through to the configuration is the whole point: a setting that lasts until the process
 * ends is a toggle, not a preference, and the language prompt appearing on every start is what that
 * feels like from the outside.
 */
function remember(name: string, value: string): void {
  void saveUserSetting(name, value).catch(() => undefined);
}

const THEMES = new Set<ThemeName>(["dark", "light", "ansi"]);

export const commands: Command[] = [
  {
    name: "help",
    summary: () => t({ en: "List these commands", ru: "Показать команды" }),
    run: () => ({
      kind: "panel",
      title: t({ en: "Commands", ru: "Команды" }),
      body: commands
        .map((command) => `/${command.name.padEnd(10)} ${command.summary()}`)
        .join("\n"),
    }),
  },
  {
    name: "status",
    summary: () =>
      t({ en: "What this run has done and cost so far", ru: "Что сделано и сколько стоило" }),
    run: (_argument, { state }) => ({
      kind: "panel",
      title: t({ en: "Run status", ru: "Состояние прогона" }),
      body: statusReport(state),
    }),
  },
  {
    name: "phases",
    summary: () => t({ en: "Where the run is", ru: "На каком этапе прогон" }),
    run: (_argument, { state }) => ({
      kind: "panel",
      title: t({ en: "Phases", ru: "Фазы" }),
      body:
        state.phases.length === 0
          ? t({
              en: "The run has not reached its first phase yet.",
              ru: "Прогон ещё не дошёл до первой фазы.",
            })
          : state.phases
              .map((phase, index) => `${index + 1}. [${phase.state}] ${phase.label || "…"}`)
              .join("\n"),
    }),
  },
  {
    name: "settings",
    summary: () =>
      t({ en: "What is set, and how to change it", ru: "Что настроено и как изменить" }),
    run: () => ({
      kind: "panel",
      title: t({ en: "Settings", ru: "Настройки" }),
      body: [
        `${t({ en: "language", ru: "язык    " })}   ${language()}   /lang en|ru`,
        `${t({ en: "theme   ", ru: "тема    " })}   ${currentTheme()}   /theme dark|light|ansi`,
        "",
        t({
          en: "Both are remembered, so they are asked for once.",
          ru: "Оба запоминаются, поэтому спрашиваются один раз.",
        }),
      ].join("\n"),
    }),
  },
  {
    name: "lang",
    summary: () => t({ en: "Switch language: en or ru", ru: "Сменить язык: en или ru" }),
    run: (argument) => {
      const value = argument.trim().toLowerCase();
      if (value !== "en" && value !== "ru") {
        return { kind: "line", tone: "warn", text: "Usage: /lang en|ru" };
      }
      setLanguage(value);
      remember("SDDC_LANG", value);
      return {
        kind: "line",
        tone: "success",
        text: t({ en: "Language set to English", ru: "Язык переключён на русский" }),
      };
    },
  },
  {
    name: "theme",
    summary: () =>
      t({ en: "Switch palette: dark, light or ansi", ru: "Сменить палитру: dark, light, ansi" }),
    run: (argument) => {
      const name = argument.trim().toLowerCase() as ThemeName;
      if (!THEMES.has(name)) {
        return { kind: "line", tone: "warn", text: "Usage: /theme dark|light|ansi" };
      }
      setTheme(name);
      remember("SDDC_THEME", name);
      return {
        kind: "line",
        tone: "success",
        text: t({ en: `Theme set to ${name}`, ru: `Тема переключена на ${name}` }),
      };
    },
  },
  {
    name: "stop",
    summary: () => t({ en: "Interrupt the work in flight", ru: "Прервать текущую работу" }),
    run: () => {
      requestInterrupt();
      return {
        kind: "line",
        tone: "warn",
        text: t({
          en: "Interrupting after the current request…",
          ru: "Прерываю после текущего запроса…",
        }),
      };
    },
  },
  {
    name: "quit",
    summary: () =>
      t({ en: "Leave, keeping everything already saved", ru: "Выйти, сохранённое остаётся" }),
    run: () => ({ kind: "quit" }),
  },
];

function statusReport(state: AppState): string {
  const usage = sessionUsage();
  const budget = budgetState();
  const done = state.phases.filter((phase) => phase.state === "done").length;
  const label = (en: string, ru: string) => t({ en, ru }).padEnd(14);
  const lines = [
    `${label("Elapsed", "Прошло")} ${Math.round((Date.now() - state.startedAt) / 1000)}s`,
    `${label("Phase", "Фаза")} ${
      state.phases.length > 0
        ? t({ en: `${done} of ${state.phases.length}`, ru: `${done} из ${state.phases.length}` })
        : t({ en: "not started", ru: "не начата" })
    }`,
    `${label("Working on", "Сейчас")} ${state.stage ?? t({ en: "nothing right now", ru: "ничего" })}`,
    `${label("Model", "Модель")} ${
      usage.calls === 0 ? t({ en: "no calls yet", ru: "вызовов ещё не было" }) : formatUsage(usage)
    }`,
  ];
  if (budget) {
    lines.push(
      `${label("Call budget", "Бюджет")} ${t({
        en: `${budget.used} of ${budget.limit}`,
        ru: `${budget.used} из ${budget.limit}`,
      })}`,
    );
  }
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
      text: t({
        en: `Unknown command /${name}. Type /help to see what there is.`,
        ru: `Неизвестная команда /${name}. Наберите /help.`,
      }),
    };
  }
  return command.run(rest.join(" ").trim(), context);
}
