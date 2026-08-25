import { Box, Static, type SuspendTerminal, Text, useApp } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { budgetState } from "../../ai/budget";
import { requestInterrupt } from "../../ai/interrupt";
import { sessionUsage } from "../../ai/usage";
import { t } from "../language";
import { theme } from "../theme";
import { CommandLine } from "./CommandLine";
import { runCommand } from "./commands";
import { Banner, Header, PhaseRail, StageIndicator, StatusBar } from "./Frame";
import { useKeys } from "./keys";
import { Panel, PanelBody } from "./Panel";
import { ConfirmPrompt, MultiSelectPrompt, SelectPrompt, TextPrompt } from "./prompts";
import type { AppState, Block, Store, Tone } from "./store";

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

  useKeys((input, key) => {
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
  });

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
          {state.pending ? (
            <PendingPrompt store={store} />
          ) : (
            <CommandLine
              busy={Boolean(state.stage) || !state.awaitingRequest}
              onCommand={(input) => handleCommand(input, state, store, exit)}
              onPlainText={(input) => {
                if (state.awaitingRequest) {
                  state.awaitingRequest(input);
                  return;
                }
                store.push({
                  kind: "line",
                  tone: "warn",
                  text: t({
                    en: "Busy. Type /status to see what, or /stop to interrupt it.",
                    ru: "Занят. /status — чем именно, /stop — прервать.",
                  }),
                });
              }}
            />
          )}
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

/** Turns a command's described outcome into what the surface actually does with it. */
function handleCommand(input: string, state: AppState, store: Store, exit: () => void): void {
  store.push({ kind: "command", text: input });
  const outcome = runCommand(input, { state });
  if (outcome.kind === "quit") {
    exit();
    process.exit(0);
  }
  if (outcome.kind === "panel") {
    store.push({ kind: "panel", title: outcome.title, body: outcome.body });
    return;
  }
  store.push({ kind: "line", tone: outcome.tone, text: outcome.text });
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
  if (block.kind === "banner") {
    return (
      <Banner
        version={block.version}
        project={block.project}
        model={block.model}
        facts={block.facts}
      />
    );
  }
  if (block.kind === "action") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={toneColor[block.tone]}>{"  ⏺  "}</Text>
          <Text color={theme.text} bold>
            {block.title}
          </Text>
        </Box>
        {block.details.map((detail, index) => (
          <Box key={detail || index}>
            <Text color={theme.muted} dimColor>
              {index === block.details.length - 1 ? "     ⎿  " : "     │  "}
            </Text>
            <Text color={theme.muted}>{detail}</Text>
          </Box>
        ))}
      </Box>
    );
  }
  if (block.kind === "command") {
    return (
      <Box>
        <Text color={theme.accent} bold>
          {"  > "}
        </Text>
        <Text color={theme.text}>{block.text}</Text>
      </Box>
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
