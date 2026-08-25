import {
  autocompleteMultiselect,
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import type { Choice, Driver, StageLabels, TextOptions } from "./driver";
import { theme } from "./theme";

const RESET = "\u001B[0m";

/** The line-oriented surface: the previous behaviour, kept for terminals the app cannot drive. */
export function createClackDriver(): Driver {
  return {
    begin: (title) => intro(paint(title, theme.accent)),
    finish: (message) => outro(message),
    info: (message) => log.info(message),
    success: (message) => log.success(message),
    warn: (message) => log.warn(message),
    step: (current, total, message) =>
      log.step(`${paint(`${current}/${total}`, theme.accent)} ${message}`),
    document: (title, content) => note(content, paint(title, theme.accent)),
    async stage(labels, operation) {
      const indicator = spinner();
      indicator.start(labels.progress);
      try {
        const result = await operation();
        indicator.stop(labels.complete);
        return result;
      } catch (error) {
        indicator.stop(labels.failed);
        throw error;
      }
    },
    // clack's `Option<Value>` is a conditional type it cannot reduce while `Value` is an unresolved
    // generic, even though `T extends string` always selects the primitive branch. Widening to
    // `string` at the call and narrowing the answer back keeps the cast to this boundary.
    async select<T extends string>(message: string, choices: Choice<T>[], initial?: T) {
      const chosen = unwrap(
        await select({
          message,
          initialValue: initial as string | undefined,
          options: choices.map((choice) => ({
            value: choice.value as string,
            label: choice.label,
            hint: choice.hint,
            disabled: choice.disabled,
          })),
        }),
      );
      return chosen as T;
    },
    async multiselect<T extends string>(message: string, choices: Choice<T>[], initial: T[]) {
      const chosen = unwrap(
        await autocompleteMultiselect({
          message,
          initialValues: initial as string[],
          required: false,
          options: choices.map((choice) => ({
            value: choice.value as string,
            label: choice.label,
            hint: choice.hint,
          })),
        }),
      );
      return chosen as T[];
    },
    async confirm(message, initial) {
      return unwrap(await confirm({ message, initialValue: initial }));
    },
    async text(message, options) {
      return unwrap(
        await text({
          message,
          placeholder: options?.placeholder,
          initialValue: options?.initial,
          validate: (value) =>
            options?.required && !value?.trim()
              ? (options.requiredMessage ?? "An answer is required")
              : undefined,
        }),
      ).trim();
    },
    cancel(message) {
      cancel(message);
      process.exit(0);
    },
  };
}

export function paint(value: string, color: string): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return value;
  const [, r = "0", g = "0", b = "0"] = /^#(..)(..)(..)$/.exec(color) ?? [];
  return `\u001B[38;2;${parseInt(r, 16)};${parseInt(g, 16)};${parseInt(b, 16)}m${value}${RESET}`;
}

function unwrap<T>(value: T | symbol): T {
  if (!isCancel(value)) return value as T;
  cancel("Cancelled");
  process.exit(0);
}

export type { Choice, StageLabels, TextOptions };
