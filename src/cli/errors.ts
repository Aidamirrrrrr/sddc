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
    const message = current.message.replace(/\s+/g, " ").trim().slice(0, 500);
    if (message && !messages.includes(message)) messages.push(message);
    current = current.cause;
  }
  if (messages.length === 0) messages.push(String(error).slice(0, 500));
  return messages;
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
