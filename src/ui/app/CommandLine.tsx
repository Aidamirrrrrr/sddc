import { Box, Text } from "ink";
import { useMemo, useState } from "react";
import { t } from "../language";
import { theme } from "../theme";
import { matchCommands } from "./commands";
import {
  breakLine,
  continuesLine,
  matchPaths,
  mentionQuery,
  pasteAction,
  replaceToken,
} from "./input-text";
import { useKeys } from "./keys";

/** How many completions are offered before the list is cut. */
const VISIBLE = 6;

/**
 * The line that is always there.
 *
 * Until now the surface only accepted input when the pipeline stopped to ask for some, so between
 * questions there was no way to say anything at all — not even "what is this doing" or "stop". The
 * line stays mounted through the work and answers from state the process already holds, which is why
 * it can respond while a stage is still in flight.
 *
 * Deliberately inert for anything that is not a command: this surface drives a pipeline rather than
 * a conversation, and quietly swallowing a sentence someone typed would be worse than saying so.
 */
export function CommandLine({
  onCommand,
  onPlainText,
  busy,
  paths = [],
}: {
  onCommand: (input: string) => void;
  onPlainText: (input: string) => void;
  busy: boolean;
  /** Repository paths offered after an `@`; empty until the index has been read. */
  paths?: string[];
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [, setRecall] = useState<number | undefined>(undefined);

  const mention = mentionQuery(value);
  const files = useMemo(
    () => (mention === undefined ? [] : matchPaths(paths, mention)),
    [paths, mention],
  );
  const completions = useMemo(
    () => (mention === undefined ? matchCommands(value) : []),
    [value, mention],
  );
  const suggestions: Suggestion[] =
    mention === undefined
      ? completions.map((command) => ({ label: `/${command.name}`, hint: command.summary() }))
      : files.map((path) => ({ label: `@${path}`, hint: "" }));
  const active = suggestions.length > 0;

  const submit = (text: string): void => {
    const trimmed = text.trim();
    setValue("");
    setCursor(0);
    setRecall(undefined);
    if (!trimmed) return;
    setHistory((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, 50));
    if (trimmed.startsWith("/")) onCommand(trimmed);
    else onPlainText(trimmed);
  };

  useKeys((input, key) => {
    if (key.return) {
      // A trailing backslash is the continuation people already know from shells, and unlike
      // shift+enter it survives every terminal.
      if (continuesLine(value)) {
        setValue(breakLine(value));
        return;
      }
      // Tab completes; enter on a half-typed name should not guess which one was meant.
      const only = suggestions.length === 1 ? suggestions[0] : undefined;
      submit(active && only ? replaceToken(value, `${only.label} `) : value);
      return;
    }
    if (key.tab && active) {
      const chosen = suggestions[Math.min(cursor, suggestions.length - 1)];
      if (chosen) {
        setValue(replaceToken(value, `${chosen.label} `));
        setCursor(0);
      }
      return;
    }
    if (key.upArrow) {
      if (active) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      // Nothing typed yet, so walking back through history is what up must mean.
      setRecall((current) => {
        const next = current === undefined ? 0 : Math.min(history.length - 1, current + 1);
        const remembered = history[next];
        if (remembered !== undefined) setValue(remembered);
        return remembered === undefined ? current : next;
      });
      return;
    }
    if (key.downArrow) {
      if (active) {
        setCursor((current) => Math.min(suggestions.length - 1, current + 1));
        return;
      }
      setRecall((current) => {
        if (current === undefined) return undefined;
        if (current === 0) {
          setValue("");
          return undefined;
        }
        setValue(history[current - 1] ?? "");
        return current - 1;
      });
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.escape) {
      const action = pasteAction(input);
      if (action.kind === "submit") submit(value + action.text);
      else setValue((current) => current + action.text);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column">
      {active ? <Completions items={suggestions} cursor={cursor} /> : null}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={busy ? theme.accentDim : theme.accent}
        paddingX={1}
      >
        {value ? (
          // Every line after the first is indented to the width of the marker, so a pasted block
          // keeps its own shape instead of being re-flowed around the prompt.
          value.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line *is* its position in the input
            <Box key={index}>
              <Text color={theme.accent}>{index === 0 ? "> " : "  "}</Text>
              <Text color={theme.text}>{line}</Text>
              {index === value.split("\n").length - 1 ? <Text color={theme.accent}>▏</Text> : null}
            </Box>
          ))
        ) : (
          <Box>
            <Text color={theme.accent}>{"> "}</Text>
            <Text color={theme.muted} dimColor>
              {busy
                ? t({
                    en: "working — /status, /stop, /help",
                    ru: "работаю — /status, /stop, /help",
                  })
                : t({
                    en: "what should I build? · / commands · @ files · \\ newline",
                    ru: "что построить? · / команды · @ файлы · \\ перенос",
                  })}
            </Text>
            <Text color={theme.accent}>▏</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** A completion offer, whether it came from the command registry or the repository index. */
type Suggestion = { label: string; hint: string };

function Completions({ items, cursor }: { items: Suggestion[]; cursor: number }) {
  const shown = items.slice(0, VISIBLE);
  const width = Math.min(32, Math.max(...items.map((item) => item.label.length)));
  return (
    <Box flexDirection="column">
      {shown.map((item, index) => {
        const selected = index === Math.min(cursor, items.length - 1);
        return (
          <Box key={item.label}>
            <Text color={selected ? theme.accent : theme.surfaceRaised}>
              {selected ? "  ▌ " : "    "}
            </Text>
            <Text color={selected ? theme.accent : theme.text} bold={selected}>
              {item.hint ? item.label.padEnd(width + 1) : item.label}
            </Text>
            <Text color={theme.muted} dimColor>
              {item.hint}
            </Text>
          </Box>
        );
      })}
      {items.length > VISIBLE ? (
        <Text color={theme.muted} dimColor>
          {`    ${items.length - VISIBLE} more`}
        </Text>
      ) : null}
    </Box>
  );
}
