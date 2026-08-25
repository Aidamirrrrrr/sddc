import { Box, Static, type SuspendTerminal, Text, useApp, useInput, useStdin } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { budgetState } from "../../ai/budget";
import { requestInterrupt } from "../../ai/interrupt";
import { sessionUsage } from "../../ai/usage";
import { theme } from "../theme";
import { Header, PhaseRail, StageIndicator, StatusBar } from "./Frame";
import { Panel, PanelBody } from "./Panel";
import { ConfirmPrompt, MultiSelectPrompt, SelectPrompt, TextPrompt } from "./prompts";
import type { Block, Store, Tone } from "./store";

const toneColor: Record<Tone, string> = {
  info: theme.text,
  success: theme.success,
  warn: theme.warning,
  danger: theme.danger,
  accent: theme.accent,
};

const toneGlyph: Record<Tone, string> = {
  info: "·",
  success: "✓",
  warn: "!",
  danger: "✗",
  accent: "◆",
};

export function App({
  store,
  subtitle,
  onReady,
}: {
  store: Store;
  subtitle: string;
  /** Hands the driver capabilities that only exist inside the React tree. */
  onReady?: (capabilities: { suspend: SuspendTerminal }) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { exit, suspendTerminal } = useApp();
  // Read every repaint rather than mirrored into the store: these are counters the model client
  // owns, and duplicating them here would give the frame a second version of the truth to drift from.
  const usage = sessionUsage();
  const budget = budgetState();
  const { isRawModeSupported } = useStdin();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    onReady?.({ suspend: suspendTerminal });
  }, [onReady, suspendTerminal]);

  // One timer drives every animated element, so the live frame repaints at a single steady rate.
  useEffect(() => {
    if (!state.stage) return;
    const timer = setInterval(() => setTick((current) => current + 1), 90);
    return () => clearInterval(timer);
  }, [state.stage]);

  // Keyboard handling needs raw mode. Guarding keeps a non-TTY stdin from throwing out of render
  // and taking the whole frame down with it.
  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        exit();
        process.exit(0);
      }
      // Only while work is in flight: outside a stage there is nothing to interrupt, and escape is
      // the key people press to dismiss things.
      if (key.escape && state.stage && !state.pending) {
        requestInterrupt();
        store.push({ kind: "line", tone: "warn", text: "Interrupting after the current request…" });
      }
    },
    // Ink only honours the guard when it is strictly `false`, so coerce rather than pass through.
    { isActive: isRawModeSupported === true },
  );

  return (
    <Box flexDirection="column">
      <Static items={state.blocks}>
        {(block) => <HistoryBlock key={block.id} block={block} />}
      </Static>

      {state.finished ? (
        <Box marginTop={1}>
          <Text backgroundColor={theme.success} color={theme.surface} bold>
            {` ✓ ${state.finished} `}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Header heading={state.heading} subtitle={subtitle} />
          <PhaseRail phases={state.phases} />
          {state.stage ? (
            <StageIndicator
              label={state.stage}
              tick={tick}
              elapsedMs={Date.now() - (state.stageStartedAt ?? state.startedAt)}
              calls={usage.calls}
              budget={budget}
            />
          ) : null}
          {state.pending ? <PendingPrompt store={store} /> : null}
          {state.pending ? null : (
            <StatusBar
              state={state}
              tick={tick}
              calls={usage.calls}
              hint={state.stage ? "esc to interrupt · ctrl+c to exit" : "ctrl+c to exit"}
            />
          )}
        </Box>
      )}
    </Box>
  );
}

function PendingPrompt({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const pending = state.pending;
  if (!pending) return null;

  if (pending.kind === "select") {
    return (
      <SelectPrompt
        message={pending.message}
        choices={pending.choices}
        initial={pending.initial}
        onSubmit={pending.resolve}
      />
    );
  }
  if (pending.kind === "multiselect") {
    return (
      <MultiSelectPrompt
        message={pending.message}
        choices={pending.choices}
        initial={pending.initial}
        onSubmit={pending.resolve}
      />
    );
  }
  if (pending.kind === "confirm") {
    return (
      <ConfirmPrompt
        message={pending.message}
        initial={pending.initial}
        onSubmit={pending.resolve}
      />
    );
  }
  return (
    <TextPrompt message={pending.message} options={pending.options} onSubmit={pending.resolve} />
  );
}

function HistoryBlock({ block }: { block: Block }) {
  if (block.kind === "panel") {
    return (
      <Panel title={block.title}>
        <PanelBody body={block.body} />
      </Panel>
    );
  }
  if (block.kind === "answer") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={theme.muted}>{"  ❯ "}</Text>
          <Text color={theme.muted}>{block.question}</Text>
        </Box>
        <Box>
          <Text color={theme.accent}>{"    "}</Text>
          <Text color={theme.text}>{block.answer}</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box>
      <Text color={toneColor[block.tone]}>{`  ${toneGlyph[block.tone]}  `}</Text>
      <Text color={block.tone === "info" ? theme.muted : toneColor[block.tone]}>{block.text}</Text>
    </Box>
  );
}
