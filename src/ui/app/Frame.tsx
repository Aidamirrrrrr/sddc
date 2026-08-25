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

export function StageIndicator({ label, tick }: { label: string; tick: number }) {
  return (
    <Box marginBottom={1}>
      <Text color={theme.accent}>{`  ${FRAMES[tick % FRAMES.length]}  `}</Text>
      <Text color={theme.text}>{label}</Text>
    </Box>
  );
}

export function StatusBar({ state, tick }: { state: AppState; tick: number }) {
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const clock = minutes > 0 ? `${minutes}m ${elapsed % 60}s` : `${elapsed}s`;
  return (
    <Box>
      <Text backgroundColor={theme.surfaceRaised} color={theme.muted}>
        {`  ${state.stage ? FRAMES[tick % FRAMES.length] : "·"}  ${clock}  ·  ${
          state.blocks.length
        } events  `}
      </Text>
      <Text color={theme.muted} dimColor>
        {"   ctrl+c to exit"}
      </Text>
    </Box>
  );
}
