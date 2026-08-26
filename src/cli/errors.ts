import { APICallError } from "@ai-sdk/provider";
import { phrase } from "./ui";

export type PresentedError = { message: string; hint?: string };

export function presentError(error: unknown): PresentedError {
  const technical = errorMessages(error);
  return {
    message: friendlyError(technical),
    hint: errorHint(technical.join(" ")),
  };
}

function errorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && messages.length < 3) {
    const message = [current.message, providerDetail(current)]
      .filter(Boolean)
      .join(": ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    if (message && !messages.includes(message)) messages.push(message);
    current = current.cause;
  }
  if (messages.length === 0) messages.push(String(error).slice(0, 500));
  return messages;
}

/**
 * What the provider actually said.
 *
 * An APICallError's message is the HTTP reason phrase and nothing else. A run against an endpoint
 * that was merely asleep reported "Bad Request" and threw away the one sentence that explained it —
 * the body said to wait until the endpoint was available. Nothing else in the run could have told
 * the user that, and the hint machinery below had nothing to match on either.
 *
 * The status code travels too: 400 and 401 call for completely different reactions, and the reason
 * phrase alone does not separate them.
 */
function providerDetail(error: Error): string {
  if (!APICallError.isInstance(error)) return "";
  const status = error.statusCode ? `HTTP ${error.statusCode}` : "";
  const body = error.responseBody?.trim();
  return [status, body ? providerMessage(body) : ""].filter(Boolean).join(" ");
}

/** Providers answer with JSON far more often than not; fall back to the raw text when they do not. */
function providerMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { message?: unknown; error?: unknown; detail?: unknown };
      const nested = record.error;
      const candidate =
        typeof nested === "string"
          ? nested
          : typeof nested === "object" && nested !== null
            ? (nested as { message?: unknown }).message
            : undefined;
      for (const value of [candidate, record.message, record.detail]) {
        if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
      }
    }
  } catch {
    // Not JSON. The raw body is still better than nothing at all.
  }
  return body.slice(0, 200);
}

function friendlyError(messages: string[]): string {
  const stage = messages[0]?.match(/^Failed (.+)$/)?.[1];
  if (!stage) return messages.join(": ");
  const label = stageLabel(stage);
  const reason = messages.slice(1).join(": ");
  return phrase({
    en: `${label} could not be completed${reason ? `: ${reason}` : "."}`,
    ru: `Не удалось завершить этап «${label}»${reason ? `: ${reason}` : "."}`,
  });
}

function stageLabel(stage: string): string {
  const labels: Record<string, { en: string; ru: string }> = {
    "planning-audit": { en: "plan quality check", ru: "проверка качества плана" },
    "planning-draft": { en: "work plan draft", ru: "черновик плана работ" },
    "planning-review": { en: "work plan review", ru: "проверка плана работ" },
    "planning-questions": { en: "plan question filter", ru: "фильтр вопросов по плану" },
    "planning-repair": { en: "work plan repair", ru: "исправление плана работ" },
    "repository-discover": { en: "project mapping", ru: "составление карты проекта" },
    "repository-review": { en: "project map review", ru: "проверка карты проекта" },
    "tasks-draft": { en: "task graph draft", ru: "черновик графа задач" },
    "tasks-audit": { en: "task coverage check", ru: "проверка покрытия задач" },
    "tasks-review": { en: "task graph review", ru: "проверка графа задач" },
    "tasks-questions": { en: "task question filter", ru: "фильтр вопросов по задачам" },
    "tasks-repair": { en: "task graph repair", ru: "исправление графа задач" },
  };
  const copy = labels[stage];
  return copy ? phrase(copy) : stage;
}

function errorHint(message: string): string | undefined {
  if (message.includes("AI_API_URL") || message.includes("AI_API_TOKEN"))
    return phrase({
      en: "Run `sddc --init`, then fill in ~/.config/sddc/.env.",
      ru: "Запустите `sddc --init`, затем заполните ~/.config/sddc/.env.",
    });
  if (message.includes("--no-input"))
    return phrase({
      en: "Pass the request after `--` or pipe it through stdin.",
      ru: "Передайте запрос после `--` или через stdin.",
    });
  if (message.includes("context approval"))
    return phrase({
      en: "Start sddc in an interactive terminal.",
      ru: "Запустите sddc в интерактивном терминале.",
    });
  if (/no (?:output|object) generated/i.test(message))
    return phrase({
      en: "The model returned no structured output twice; its output budget is likely exhausted by reasoning. Raise AI_MAX_OUTPUT_TOKENS in ~/.config/sddc/.env, or rerun with --thinking off.",
      ru: "Модель дважды не вернула структурированный ответ; скорее всего, бюджет вывода израсходован на рассуждения. Увеличьте AI_MAX_OUTPUT_TOKENS в ~/.config/sddc/.env или повторите запуск с --thinking off.",
    });
  // Anything the endpoint itself refused. Retryable statuses never reach here — backoff has already
  // spent its attempts on those — so what is left is a request the provider will keep refusing.
  if (/HTTP 40[0134]/.test(message))
    return phrase({
      en: "The provider refused the request. Check that the endpoint is running and that AI_MODEL names a model it serves.",
      ru: "Провайдер отклонил запрос. Проверьте, что эндпоинт запущен и что AI_MODEL — это модель, которую он обслуживает.",
    });
  if (/fetch|network|timed? out|ECONN/i.test(message))
    return phrase({
      en: "Check the model endpoint and network connection, then repeat the command.",
      ru: "Проверьте endpoint модели и подключение к сети, затем повторите команду.",
    });
  if (/planning-|repository-|tasks-|execution-|structured|schema|validation/i.test(message))
    return phrase({
      en: "The model returned an invalid structured response twice. Retry once or use --thinking on.",
      ru: "Модель дважды вернула некорректный структурированный ответ. Повторите запуск или включите --thinking on.",
    });
  return undefined;
}
