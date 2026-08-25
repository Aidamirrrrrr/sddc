import { startApp, stopApp } from "../ui/app";
import { createClackDriver, paint } from "../ui/clack";
import { type Choice, driver, setDriver, type TextOptions } from "../ui/driver";
import { createStreamDriver } from "../ui/stream";
import { theme } from "../ui/theme";
import type { ReviewDecision } from "./approval";

export type Copy = { en: string; ru: string };
export type OutputMode = "app" | "interactive" | "plain" | "json";

let russian = false;
let outputMode: OutputMode = "interactive";
// Keeps the module usable before the CLI has resolved its output mode, matching the previous default.
setDriver(createClackDriver());

export function setOutputMode(mode: OutputMode): void {
  outputMode = mode;
  if (mode === "app") {
    setDriver(startApp());
    return;
  }
  setDriver(mode === "plain" || mode === "json" ? createStreamDriver(mode) : createClackDriver());
}

/** Releases the terminal before anything outside the driver writes to stdout. */
export function teardownUi(): void {
  if (outputMode === "app") stopApp();
}

export function currentOutputMode(): OutputMode {
  return outputMode;
}

export function setUiLanguage(language: string): void {
  russian = /^(ru|russian|рус)/i.test(language.trim());
}

export async function chooseUiLanguage(language?: "en" | "ru"): Promise<void> {
  if (language) {
    setUiLanguage(language);
    return;
  }
  // A configured preference is an answer already given; asking again every run is not a choice.
  const configured = Bun.env.SDDC_LANG?.trim();
  if (configured) {
    setUiLanguage(configured);
    return;
  }
  setUiLanguage(
    await driver().select(
      "Choose language / Выберите язык",
      [
        { value: "ru", label: "Русский" },
        { value: "en", label: "English" },
      ],
      /^ru/i.test(process.env.LANG ?? "") ? "ru" : "en",
    ),
  );
}

export function phrase(copy: Copy): string {
  return russian ? copy.ru : copy.en;
}

export function accent(value: string): string {
  return outputMode === "interactive" ? paint(value, theme.accent) : value;
}

export function muted(value: string): string {
  return outputMode === "interactive" ? paint(value, theme.muted) : value;
}

export function begin(): void {
  driver().begin("sddc");
}

export function finish(copy: Copy): void {
  driver().finish(phrase(copy));
}

export function info(copy: Copy): void {
  driver().info(phrase(copy));
}

export function success(copy: Copy): void {
  driver().success(phrase(copy));
}

export function warn(copy: Copy): void {
  driver().warn(phrase(copy));
}

export function step(current: number, total: number, copy: Copy): void {
  driver().step(current, total, phrase(copy));
}

export function document(title: Copy, content: string): void {
  driver().document(phrase(title), content);
}

export async function withSpinner<T>(
  progress: Copy,
  complete: Copy,
  operation: () => Promise<T>,
): Promise<T> {
  return driver().stage(
    {
      progress: phrase(progress),
      complete: phrase(complete),
      failed: phrase({ en: "Stage failed", ru: "Ошибка этапа" }),
    },
    operation,
  );
}

export async function choose<T extends string>(
  message: Copy,
  choices: Choice<T>[],
  initial?: T,
): Promise<T> {
  return driver().select(phrase(message), choices, initial);
}

export async function chooseMany<T extends string>(
  message: Copy,
  choices: Choice<T>[],
  initial: T[],
): Promise<T[]> {
  return driver().multiselect(phrase(message), choices, initial);
}

export async function confirm(message: Copy, initial = false): Promise<boolean> {
  return driver().confirm(phrase(message), initial);
}

export async function prompt(message: Copy, options?: TextOptions): Promise<string> {
  return driver().text(phrase(message), options);
}

export function abort(message: Copy): never {
  return driver().cancel(phrase(message));
}

export async function review(message: Copy): Promise<ReviewDecision> {
  return driver().select(phrase(message), [
    {
      value: "accept" as const,
      label: accent(phrase({ en: "Accept", ru: "Принять" })),
      hint: phrase({ en: "continue to the next stage", ru: "перейти к следующему этапу" }),
    },
    {
      value: "revise" as const,
      label: phrase({ en: "Revise", ru: "Исправить" }),
      hint: phrase({ en: "describe what should change", ru: "описать, что нужно изменить" }),
    },
  ]);
}

/** What the user can do with an artifact that is waiting for approval. */
export type ArtifactAction = "accept" | "revise" | "edit" | "decisions";

export async function reviewDocument(
  message: Copy,
  title: Copy,
  summary: string,
  content: string,
): Promise<ArtifactAction> {
  document(title, summary);
  while (true) {
    const action = await driver().select(phrase(message), [
      {
        value: "accept" as const,
        label: accent(phrase({ en: "Accept", ru: "Принять" })),
        hint: phrase({ en: "continue to the next stage", ru: "перейти к следующему этапу" }),
      },
      {
        value: "details" as const,
        label: phrase({ en: "View full document", ru: "Показать документ полностью" }),
      },
      {
        value: "edit" as const,
        label: phrase({ en: "Edit directly", ru: "Отредактировать самому" }),
        hint: phrase({ en: "open in $EDITOR", ru: "открыть в $EDITOR" }),
      },
      {
        value: "revise" as const,
        label: phrase({ en: "Ask for a revision", ru: "Попросить исправить" }),
        hint: phrase({ en: "describe what should change", ru: "описать, что нужно изменить" }),
      },
      {
        value: "decisions" as const,
        label: phrase({ en: "Decisions so far", ru: "Принятые решения" }),
      },
    ]);
    if (action === "details") {
      document(title, content);
      continue;
    }
    return action;
  }
}

export async function required(message: Copy): Promise<string> {
  return driver().text(phrase(message), {
    required: true,
    requiredMessage: phrase({ en: "An answer is required", ru: "Нужен ответ" }),
  });
}
