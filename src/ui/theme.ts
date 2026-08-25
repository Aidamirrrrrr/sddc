/**
 * The colour vocabulary, and the terminals it has to survive.
 *
 * Blocks are drawn as filled surfaces rather than bordered boxes, so the session reads as an
 * application rather than a stream of terminal lines. That only holds if the palette matches the
 * terminal underneath: a true-colour palette on a 16-colour SSH session renders as mud, and a dark
 * palette on a light terminal renders as unreadable. So there are three, chosen from the
 * environment and overridable by hand.
 *
 * Every surface that paints a background also sets its own foreground, so no panel can end up
 * borrowing the terminal's idea of contrast.
 */
export type Palette = {
  accent: string;
  accentDim: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  added: string;
  removed: string;
};

const DARK: Palette = {
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
};

const LIGHT: Palette = {
  accent: "#b8542f",
  accentDim: "#8c4023",
  surface: "#faf9f7",
  surfaceRaised: "#ece9e4",
  text: "#1c1917",
  muted: "#6b645d",
  success: "#3f6b2a",
  warning: "#8a5a12",
  danger: "#a32f2f",
  added: "#3f6b2a",
  removed: "#a32f2f",
};

/**
 * The sixteen names every terminal agrees on.
 *
 * `surface` is deliberately the terminal's own background rather than a colour: painting a "black"
 * panel onto a light ANSI terminal is exactly the unreadable case this theme exists to avoid.
 */
const ANSI: Palette = {
  accent: "yellow",
  accentDim: "yellow",
  surface: "black",
  surfaceRaised: "blackBright",
  text: "white",
  muted: "gray",
  success: "green",
  warning: "yellow",
  danger: "red",
  added: "green",
  removed: "red",
};

const PALETTES = { dark: DARK, light: LIGHT, ansi: ANSI } as const;
export type ThemeName = keyof typeof PALETTES;

let active: Palette = DARK;

/**
 * Read through a proxy so a theme can be chosen after the modules that use it were imported.
 *
 * Every call site reads `theme.accent` at render time, which is exactly when the answer is known;
 * exporting the palette directly would have frozen whichever one happened to be default at import.
 */
export const theme: Palette = new Proxy({} as Palette, {
  get: (_target, key: string) => active[key as keyof Palette],
  ownKeys: () => Object.keys(active),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

export function setTheme(name: ThemeName): void {
  active = PALETTES[name];
}

export function currentTheme(): ThemeName {
  return (Object.keys(PALETTES) as ThemeName[]).find((name) => PALETTES[name] === active) ?? "dark";
}

/**
 * Picks a theme from the environment.
 *
 * `NO_COLOR` and a missing `COLORTERM` both mean the same thing here — assume the terminal cannot
 * be trusted with hex — while `COLORFGBG` is the one widely-set hint about whether the background
 * is light. Anything unstated stays dark, which is what most terminals are.
 */
export function detectTheme(env: Record<string, string | undefined> = process.env): ThemeName {
  if (env.SDDC_THEME && env.SDDC_THEME in PALETTES) return env.SDDC_THEME as ThemeName;
  if (env.NO_COLOR) return "ansi";
  const trueColor = env.COLORTERM === "truecolor" || env.COLORTERM === "24bit";
  if (!trueColor) return "ansi";
  // "foreground;background" — a high background number is a light terminal.
  const background = Number(env.COLORFGBG?.split(";").at(-1));
  return Number.isInteger(background) && background >= 7 ? "light" : "dark";
}

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
