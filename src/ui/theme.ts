/**
 * A dark panel palette. Blocks are drawn as filled surfaces rather than as bordered boxes, so the
 * session reads as an application rather than as a stream of terminal lines.
 *
 * Backgrounds are only ever painted on a surface that also sets its own foreground, so a terminal
 * running a light theme still renders readable text inside every panel.
 */
export const theme = {
  accent: "#d97757",
  accentDim: "#a85c42",
  surface: "#1c1917",
  surfaceRaised: "#292524",
  text: "#e7e5e4",
  muted: "#8f8880",
  success: "#7fb069",
  warning: "#e0a458",
  danger: "#d16060",
  added: "#7fb069",
  removed: "#d16060",
} as const;

/** Phase states drive both the rail glyph and its colour. */
export const phaseGlyph = {
  pending: "·",
  active: "◐",
  done: "✓",
  failed: "✗",
} as const;

export type PhaseState = keyof typeof phaseGlyph;

export function phaseColor(state: PhaseState): string {
  if (state === "done") return theme.success;
  if (state === "active") return theme.accent;
  if (state === "failed") return theme.danger;
  return theme.muted;
}
