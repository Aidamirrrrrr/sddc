import { afterEach, expect, test } from "bun:test";
import { presentError } from "./errors";
import { setUiLanguage } from "./ui";

afterEach(() => setUiLanguage("English"));

test("presents nested stage failures with a useful localized recovery hint", () => {
  setUiLanguage("ru");
  const error = new Error("Failed planning-audit", {
    cause: new Error("Response did not match schema"),
  });

  expect(presentError(error)).toEqual({
    message: "Не удалось завершить этап «проверка качества плана»: Response did not match schema",
    hint: "Модель дважды вернула некорректный структурированный ответ. Повторите запуск или включите --thinking on.",
  });
});

test("explains an exhausted output budget behind a named task stage", () => {
  const error = new Error("Failed tasks-audit", { cause: new Error("No output generated.") });

  expect(presentError(error)).toEqual({
    message: "task coverage check could not be completed: No output generated.",
    hint: "The model returned no structured output twice; its output budget is likely exhausted by reasoning. Raise AI_MAX_OUTPUT_TOKENS in ~/.config/sddc/.env, or rerun with --thinking off.",
  });
});
