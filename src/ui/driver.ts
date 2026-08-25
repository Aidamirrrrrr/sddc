/**
 * The seam between the pipeline and whatever is drawing it.
 *
 * Workflows await these methods and never learn which surface answered: the Ink application, the
 * line-oriented fallback, or the JSON event stream. Every prompt is a promise so a React surface can
 * resolve it from an event handler instead of blocking the render loop.
 */
/** Values are strings so every surface can round-trip a choice through a plain text protocol. */
export type Choice<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export type TextOptions = {
  placeholder?: string;
  /** Pre-fills the field so an existing value can be edited rather than retyped. */
  initial?: string;
  /** Rejects an empty answer and re-asks instead of returning it. */
  required?: boolean;
  requiredMessage?: string;
};

export type Driver = {
  begin(title: string): void;
  /**
   * Opens the session with what it is working on and with.
   *
   * Separate from `begin` because it is content rather than chrome: it belongs in the scrollback
   * where someone scrolling back to check which model ran will actually find it.
   */
  banner(details: { version: string; project: string; model: string; facts: string[] }): void;
  finish(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  step(current: number, total: number, message: string): void;
  document(title: string, content: string): void;
  /**
   * Work that happened: a summary line with its evidence hanging off it.
   *
   * Separate from `document` because the two are read differently — a document is opened and read,
   * an action is glanced at while scrolling past. Surfaces without a notion of structure may render
   * it as the summary followed by its lines.
   */
  action(summary: string, details: string[], tone?: "info" | "success" | "warn" | "danger"): void;
  /** Reports a long model call. Implementations may render progress; all must await the operation. */
  stage<T>(labels: StageLabels, operation: () => Promise<T>): Promise<T>;
  select<T extends string>(message: string, choices: Choice<T>[], initial?: T): Promise<T>;
  multiselect<T extends string>(message: string, choices: Choice<T>[], initial: T[]): Promise<T[]>;
  confirm(message: string, initial: boolean): Promise<boolean>;
  text(message: string, options?: TextOptions): Promise<string>;
  /** Ends the session on an explicit user cancellation. Never returns. */
  cancel(message: string): never;
  /**
   * Hands the terminal to a child process and takes it back afterwards.
   *
   * Only the application surface needs this: it holds the screen, so spawning an editor over it
   * would corrupt the frame. Line-oriented surfaces leave it undefined and the operation just runs.
   */
  suspend?<T>(operation: () => Promise<T>): Promise<T>;
};

/** Runs an operation with the terminal released, whether or not the surface needs releasing. */
export async function withSuspendedUi<T>(operation: () => Promise<T>): Promise<T> {
  const active = driver();
  return active.suspend ? active.suspend(operation) : operation();
}

export type StageLabels = { progress: string; complete: string; failed: string };

let active: Driver | undefined;

export function setDriver(driver: Driver): void {
  active = driver;
}

export function driver(): Driver {
  if (!active) throw new Error("No UI driver has been installed");
  return active;
}
