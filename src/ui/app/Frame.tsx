import { Box, Text } from "ink";
import { phaseColor, phaseGlyph, theme } from "../theme";
import type { AppState, Phase } from "./store";

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

export function Header({ heading, subtitle }: { heading: string; subtitle: string }) {
  return (
    <Box marginBottom={1}>
      <Text backgroundColor={theme.accent} color={theme.surface} bold>
        {` ◆ ${heading} `}
      </Text>
      <Text backgroundColor={theme.surfaceRaised} color={theme.muted}>
        {` ${subtitle} `}
      </Text>
    </Box>
  );
}

/** The persistent rail: what the run is made of, and where it currently is. */
export function PhaseRail({ phases }: { phases: Phase[] }) {
  if (phases.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {phases.map((phase, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a phase *is* its position in the run
        <PhaseRow key={index} index={index} phase={phase} />
      ))}
    </Box>
  );
}

function PhaseRow({ index, phase }: { index: number; phase: Phase }) {
  const color = phaseColor(phase.state);
  const active = phase.state === "active";
  return (
    <Box>
      <Text color={active ? theme.accent : theme.muted}>{`  ${CIRCLED[index] ?? "·"}  `}</Text>
      <Text color={color} bold={active}>
        {phaseGlyph[phase.state]}
      </Text>
      <Text color={active ? theme.text : theme.muted} bold={active}>
        {`  ${phase.label || "…"}`}
      </Text>
    </Box>
  );
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Seconds as a person reads them. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/**
 * What the run is spending, while it spends it.
 *
 * A stage can take two minutes with nothing to show, and a spinner alone cannot tell "thinking" from
 * "wedged". Elapsed time, calls made and the share of the budget they came from are the three facts
 * that separate those, and all three are already being tracked — they were simply never displayed
 * until the run was over.
 */
export function StageIndicator({
  label,
  tick,
  elapsedMs,
  calls,
  budget,
}: {
  label: string;
  tick: number;
  elapsedMs: number;
  calls: number;
  budget?: { used: number; limit: number };
}) {
  const parts = [clock(elapsedMs), `${calls} calls`];
  if (budget) parts.push(`${budget.used}/${budget.limit}`);
  parts.push("esc to interrupt");
  const counters = `(${parts.join(" · ")})`;
  return (
    <Box marginBottom={1}>
      <Box marginLeft={2} marginRight={2}>
        <Text color={theme.accent}>{FRAMES[tick % FRAMES.length]}</Text>
      </Box>
      {/* The label yields, not the counters: a stage name that wraps pushes the numbers off the
          line and leaves the reader with neither half. */}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={theme.text} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Box marginLeft={2} flexShrink={0}>
        <Text color={theme.muted} dimColor wrap="truncate-end">
          {counters}
        </Text>
      </Box>
    </Box>
  );
}

export function StatusBar({
  state,
  tick,
  calls,
  hint,
}: {
  state: AppState;
  tick: number;
  calls: number;
  hint: string;
}) {
  // "N events" counted repaints, which is a fact about the renderer and not about the work. What a
  // person wants from a status bar is how long this has taken and what it has cost.
  const done = state.phases.filter((phase) => phase.state === "done").length;
  const summary = [
    clock(Date.now() - state.startedAt),
    state.phases.length > 0 ? `phase ${done}/${state.phases.length}` : undefined,
    `${calls} model calls`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <Box>
      <Text backgroundColor={theme.surfaceRaised} color={theme.muted}>
        {`  ${state.stage ? FRAMES[tick % FRAMES.length] : "·"}  ${summary}  `}
      </Text>
      <Text color={theme.muted} dimColor>
        {`   ${hint}`}
      </Text>
    </Box>
  );
}
