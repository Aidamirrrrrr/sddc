import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { Choice, TextOptions } from "../driver";
import { theme } from "../theme";

/** How many rows a list prompt shows before it starts scrolling. */
const WINDOW = 12;

function Question({ message }: { message: string }) {
  return (
    <Box marginBottom={1}>
      <Text color={theme.accent} bold>
        {"  ❯ "}
      </Text>
      <Text color={theme.text} bold>
        {message}
      </Text>
    </Box>
  );
}

function Hint({ children }: { children: string }) {
  return (
    <Box marginTop={1}>
      <Text color={theme.muted} dimColor>
        {`  ${children}`}
      </Text>
    </Box>
  );
}

/** Moves through selectable rows, skipping disabled ones in the direction of travel. */
function nextEnabled<T extends string>(choices: Choice<T>[], from: number, step: number): number {
  for (let offset = 1; offset <= choices.length; offset += 1) {
    const index = (from + step * offset + choices.length * offset) % choices.length;
    if (!choices[index]?.disabled) return index;
  }
  return from;
}

export function SelectPrompt({
  message,
  choices,
  initial,
  onSubmit,
}: {
  message: string;
  choices: Choice<string>[];
  initial?: string;
  onSubmit: (value: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const index = choices.findIndex((choice) => choice.value === initial && !choice.disabled);
    return index >= 0
      ? index
      : Math.max(
          0,
          choices.findIndex((choice) => !choice.disabled),
        );
  });

  useInput((_input, key) => {
    if (key.upArrow) setCursor((current) => nextEnabled(choices, current, -1));
    else if (key.downArrow) setCursor((current) => nextEnabled(choices, current, 1));
    else if (key.return) {
      const choice = choices[cursor];
      if (choice && !choice.disabled) onSubmit(choice.value);
    }
  });

  // Long lists (file pickers, feature lists) are windowed so the prompt never outgrows the frame.
  const start = Math.max(0, Math.min(cursor - 5, choices.length - WINDOW));
  const window = choices.slice(Math.max(0, start), Math.max(0, start) + WINDOW);

  return (
    <Box flexDirection="column">
      <Question message={message} />
      {window.map((choice) => {
        const index = choices.indexOf(choice);
        const selected = index === cursor;
        const color = choice.disabled ? theme.muted : selected ? theme.accent : theme.text;
        return (
          <Box key={choice.value}>
            <Text color={selected ? theme.accent : theme.surfaceRaised}>
              {selected ? "  ▌ " : "    "}
            </Text>
            <Text color={color} bold={selected} dimColor={choice.disabled}>
              {choice.label}
            </Text>
            {choice.hint ? (
              <Text color={theme.muted} dimColor>
                {`  ${choice.hint}`}
              </Text>
            ) : null}
          </Box>
        );
      })}
      {choices.length > WINDOW ? (
        <Text color={theme.muted} dimColor>
          {`    ${cursor + 1} of ${choices.length}`}
        </Text>
      ) : null}
      <Hint>↑↓ move · enter select</Hint>
    </Box>
  );
}

export function ConfirmPrompt({
  message,
  initial,
  onSubmit,
}: {
  message: string;
  initial: boolean;
  onSubmit: (value: boolean) => void;
}) {
  const [value, setValue] = useState(initial);

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === "\t") setValue((current) => !current);
    else if (input.toLowerCase() === "y") onSubmit(true);
    else if (input.toLowerCase() === "n") onSubmit(false);
    else if (key.return) onSubmit(value);
  });

  return (
    <Box flexDirection="column">
      <Question message={message} />
      <Box>
        <Text color={value ? theme.accent : theme.muted} bold={value}>
          {value ? "  ▌ Yes" : "    Yes"}
        </Text>
        <Text color={value ? theme.muted : theme.accent} bold={!value}>
          {value ? "    No" : "  ▌ No"}
        </Text>
      </Box>
      <Hint>y/n · ←→ switch · enter confirm</Hint>
    </Box>
  );
}

/**
 * Filter-as-you-type multi-select. The file context selector offers more paths than fit on a screen,
 * so typing narrows the list instead of scrolling it.
 */
export function MultiSelectPrompt({
  message,
  choices,
  initial,
  onSubmit,
}: {
  message: string;
  choices: Choice<string>[];
  initial: string[];
  onSubmit: (value: string[]) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(initial));
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const visible = useMemo(() => {
    const needle = query.toLowerCase();
    return choices.filter((choice) => choice.label.toLowerCase().includes(needle));
  }, [choices, query]);

  const window = visible.slice(Math.max(0, cursor - 6), Math.max(0, cursor - 6) + 12);

  useInput((input, key) => {
    if (key.upArrow) setCursor((current) => Math.max(0, current - 1));
    else if (key.downArrow) setCursor((current) => Math.min(visible.length - 1, current + 1));
    else if (input === " ") {
      const choice = visible[cursor];
      if (!choice) return;
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(choice.value)) next.delete(choice.value);
        else next.add(choice.value);
        return next;
      });
    } else if (key.return) {
      onSubmit(
        choices.filter((choice) => selected.has(choice.value)).map((choice) => choice.value),
      );
    } else if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      setCursor(0);
    } else if (input && !key.ctrl && !key.meta) {
      setQuery((current) => current + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column">
      <Question message={message} />
      <Box marginBottom={1}>
        <Text color={theme.muted}>{"  filter "}</Text>
        <Text color={theme.text}>{query || "…"}</Text>
        <Text color={theme.muted} dimColor>
          {`   ${selected.size} selected of ${choices.length}`}
        </Text>
      </Box>
      {window.map((choice) => {
        const index = visible.indexOf(choice);
        const active = index === cursor;
        const checked = selected.has(choice.value);
        return (
          <Box key={choice.value}>
            <Text color={active ? theme.accent : theme.surfaceRaised}>
              {active ? "  ▌ " : "    "}
            </Text>
            <Text color={checked ? theme.success : theme.muted}>{checked ? "◉ " : "◯ "}</Text>
            <Text color={active ? theme.text : theme.muted} bold={active}>
              {choice.label}
            </Text>
            {choice.hint ? (
              <Text color={theme.muted} dimColor>
                {`  ${choice.hint}`}
              </Text>
            ) : null}
          </Box>
        );
      })}
      <Hint>type to filter · space toggle · ↑↓ move · enter confirm</Hint>
    </Box>
  );
}

export function TextPrompt({
  message,
  options,
  onSubmit,
}: {
  message: string;
  options: TextOptions;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(options.initial ?? "");
  const [error, setError] = useState("");

  useInput((input, key) => {
    if (key.return) {
      if (options.required && !value.trim()) {
        setError(options.requiredMessage ?? "An answer is required");
        return;
      }
      onSubmit(value.trim());
    } else if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      setError("");
    } else if (input && !key.ctrl && !key.meta) {
      setValue((current) => current + input);
      setError("");
    }
  });

  return (
    <Box flexDirection="column">
      <Question message={message} />
      <Box backgroundColor={theme.surfaceRaised} paddingX={2}>
        <Text color={theme.accent} backgroundColor={theme.surfaceRaised}>
          {"❯ "}
        </Text>
        <Text color={theme.text} backgroundColor={theme.surfaceRaised}>
          {value || options.placeholder || ""}
        </Text>
        <Text color={theme.accent} backgroundColor={theme.surfaceRaised}>
          {"▏"}
        </Text>
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.danger}>{`  ${error}`}</Text>
        </Box>
      ) : (
        <Hint>enter to submit</Hint>
      )}
    </Box>
  );
}
