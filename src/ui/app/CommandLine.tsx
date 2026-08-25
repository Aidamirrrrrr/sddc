import { Box, Text } from "ink";
import { useMemo, useState } from "react";
import { t } from "../language";
import { theme } from "../theme";
import { type Command, matchCommands } from "./commands";
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
}: {
  onCommand: (input: string) => void;
  onPlainText: (input: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [, setRecall] = useState<number | undefined>(undefined);

  const completions = useMemo(() => matchCommands(value), [value]);
  const active = completions.length > 0 && value.startsWith("/");

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
      // Tab completes; enter on a half-typed name should not guess which one was meant.
      submit(active && completions.length === 1 ? `/${completions[0]?.name} ` : value);
      return;
    }
    if (key.tab && active) {
      const chosen = completions[Math.min(cursor, completions.length - 1)];
      if (chosen) {
        setValue(`/${chosen.name} `);
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
        setCursor((current) => Math.min(completions.length - 1, current + 1));
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
      // A paste arrives as one chunk, so a newline inside it never raises key.return.
      const [typed = "", ...rest] = input.split(/\r|\n/);
      if (rest.length > 0) {
        submit(value + typed);
        return;
      }
      setValue((current) => current + typed);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column">
      {active ? <Completions items={completions} cursor={cursor} /> : null}
      <Box borderStyle="round" borderColor={busy ? theme.accentDim : theme.accent} paddingX={1}>
        <Text color={theme.accent}>{"> "}</Text>
        {value ? (
          <Text color={theme.text}>{value}</Text>
        ) : (
          <Text color={theme.muted} dimColor>
            {busy
              ? t({ en: "working — /status, /stop, /help", ru: "работаю — /status, /stop, /help" })
              : t({ en: "what should I build? · /help", ru: "что построить? · /help" })}
          </Text>
        )}
        <Text color={theme.accent}>▏</Text>
      </Box>
    </Box>
  );
}

function Completions({ items, cursor }: { items: Command[]; cursor: number }) {
  const shown = items.slice(0, VISIBLE);
  return (
    <Box flexDirection="column">
      {shown.map((command, index) => {
        const selected = index === Math.min(cursor, items.length - 1);
        return (
          <Box key={command.name}>
            <Text color={selected ? theme.accent : theme.surfaceRaised}>
              {selected ? "  ▌ " : "    "}
            </Text>
            <Text color={selected ? theme.accent : theme.text} bold={selected}>
              {`/${command.name}`.padEnd(12)}
            </Text>
            <Text color={theme.muted} dimColor>
              {command.summary()}
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
