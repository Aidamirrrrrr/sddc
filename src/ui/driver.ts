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
  finish(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  step(current: number, total: number, message: string): void;
  document(title: string, content: string): void;
  /** Reports a long model call. Implementations may render progress; all must await the operation. */
  stage<T>(labels: StageLabels, operation: () => Promise<T>): Promise<T>;
  select<T extends string>(message: string, choices: Choice<T>[], initial?: T): Promise<T>;
  multiselect<T extends string>(message: string, choices: Choice<T>[], initial: T[]): Promise<T[]>;
  confirm(message: string, initial: boolean): Promise<boolean>;
  text(message: string, options?: TextOptions): Promise<string>;
  /** Ends the session on an explicit user cancellation. Never returns. */
  cancel(message: string): never;
};

export type StageLabels = { progress: string; complete: string; failed: string };

let active: Driver | undefined;

export function setDriver(driver: Driver): void {
  active = driver;
}

export function driver(): Driver {
  if (!active) throw new Error("No UI driver has been installed");
  return active;
}
