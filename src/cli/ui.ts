import { cancel, intro, isCancel, log, note, outro, select, spinner, text } from "@clack/prompts";
import type { ReviewDecision } from "./approval";

export type Copy = { en: string; ru: string };

const RESET = "\u001B[0m";
const CLAUDE_ORANGE = "\u001B[38;2;217;119;87m";
const CLAUDE_MUTED = "\u001B[38;2;155;140;126m";

let russian = false;
let outputMode: "interactive" | "plain" | "json" = "interactive";

export function setOutputMode(mode: "interactive" | "plain" | "json"): void {
  outputMode = mode;
}

export function setUiLanguage(language: string): void {
  russian = /^(ru|russian|рус)/i.test(language.trim());
}

export async function chooseUiLanguage(language?: "en" | "ru"): Promise<void> {
  if (language) {
    setUiLanguage(language);
    return;
  }
  const selected = unwrap(
    await select({
      message: "Choose language / Выберите язык",
      initialValue: /^ru/i.test(process.env.LANG ?? "") ? "ru" : "en",
      options: [
        { value: "ru" as const, label: "Русский" },
        { value: "en" as const, label: "English" },
      ],
    }),
  );
  setUiLanguage(selected);
}

export function phrase(copy: Copy): string {
  return russian ? copy.ru : copy.en;
}

export function accent(value: string): string {
  return paint(value, CLAUDE_ORANGE);
}

export function muted(value: string): string {
  return paint(value, CLAUDE_MUTED);
}

export function begin(): void {
  if (outputMode === "json") {
    emit("start", { name: "sddc" });
    return;
  }
  if (outputMode === "plain") {
    console.log("sddc");
    return;
  }
  intro(accent("sddc"));
}

export function finish(copy: Copy): void {
  if (writeSimple("finish", phrase(copy))) return;
  outro(phrase(copy));
}

export function info(copy: Copy): void {
  if (writeSimple("info", phrase(copy))) return;
  log.info(phrase(copy));
}

export function success(copy: Copy): void {
  if (writeSimple("success", phrase(copy))) return;
  log.success(phrase(copy));
}

export function step(current: number, total: number, copy: Copy): void {
  if (outputMode === "json") {
    emit("step", { current, total, message: phrase(copy) });
    return;
  }
  if (outputMode === "plain") {
    console.log(`[${current}/${total}] ${phrase(copy)}`);
    return;
  }
  log.step(`${accent(`${current}/${total}`)} ${phrase(copy)}`);
}

export function document(title: Copy, content: string): void {
  if (outputMode === "json") {
    emit("document", { title: phrase(title), content });
    return;
  }
  if (outputMode === "plain") {
    console.log(`\n${phrase(title)}\n${content}`);
    return;
  }
  note(content, accent(phrase(title)));
}

export async function withSpinner<T>(progress: Copy, complete: Copy, operation: () => Promise<T>) {
  if (outputMode !== "interactive") {
    info(progress);
    const result = await operation();
    success(complete);
    return result;
  }
  const indicator = spinner();
  indicator.start(phrase(progress));
  try {
    const result = await operation();
    indicator.stop(phrase(complete));
    return result;
  } catch (error) {
    indicator.stop(phrase({ en: "Stage failed", ru: "Ошибка этапа" }));
    throw error;
  }
}

function emit(type: string, payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ type, ...payload }));
}

function writeSimple(type: string, message: string): boolean {
  if (outputMode === "json") {
    emit(type, { message });
    return true;
  }
  if (outputMode === "plain") {
    console.log(message);
    return true;
  }
  return false;
}

export async function review(message: Copy): Promise<ReviewDecision> {
  return unwrap(
    await select({
      message: phrase(message),
      options: [
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
      ],
    }),
  );
}

export async function reviewDocument(
  message: Copy,
  title: Copy,
  summary: string,
  content: string,
): Promise<ReviewDecision> {
  document(title, summary);
  while (true) {
    const action = unwrap(
      await select({
        message: phrase(message),
        options: [
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
            value: "revise" as const,
            label: phrase({ en: "Revise", ru: "Исправить" }),
            hint: phrase({ en: "describe what should change", ru: "описать, что нужно изменить" }),
          },
        ],
      }),
    );
    if (action === "details") {
      document(title, content);
      continue;
    }
    return action;
  }
}

export async function required(message: Copy): Promise<string> {
  return unwrap(
    await text({
      message: phrase(message),
      validate: (value) =>
        value?.trim() ? undefined : phrase({ en: "An answer is required", ru: "Нужен ответ" }),
    }),
  ).trim();
}

function unwrap<T>(value: T | symbol): T {
  if (!isCancel(value)) return value as T;
  cancel(phrase({ en: "Cancelled", ru: "Отменено" }));
  process.exit(0);
}

function paint(value: string, color: string): string {
  if (outputMode !== "interactive" || !process.stdout.isTTY || process.env.NO_COLOR) return value;
  return `${color}${value}${RESET}`;
}
