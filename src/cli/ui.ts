import { cancel, intro, isCancel, log, note, outro, select, spinner, text } from "@clack/prompts";
import type { ReviewDecision } from "./approval";

export type Copy = { en: string; ru: string };

let russian = false;

export function setUiLanguage(language: string): void {
  russian = /^(ru|russian|рус)/i.test(language.trim());
}

export function phrase(copy: Copy): string {
  return russian ? copy.ru : copy.en;
}

export function begin(): void {
  intro("Codekeeper");
}

export function finish(copy: Copy): void {
  outro(phrase(copy));
}

export function info(copy: Copy): void {
  log.info(phrase(copy));
}

export function success(copy: Copy): void {
  log.success(phrase(copy));
}

export function document(title: Copy, content: string): void {
  note(content, phrase(title));
}

export async function withSpinner<T>(progress: Copy, complete: Copy, operation: () => Promise<T>) {
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

export async function review(message: Copy): Promise<ReviewDecision> {
  return unwrap(
    await select({
      message: phrase(message),
      options: [
        {
          value: "accept" as const,
          label: phrase({ en: "Accept", ru: "Принять" }),
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
