import { afterEach, expect, test } from "bun:test";
import { APICallError } from "@ai-sdk/provider";
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

test("the provider's own explanation reaches the user", () => {
  // "Bad Request" on its own is unactionable. The body carried the only sentence that said what to
  // do about it, and it was being dropped on the floor.
  const error = new APICallError({
    message: "Bad Request",
    url: "https://example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: JSON.stringify({ message: "Wait until status `available`." }),
  });

  const presented = presentError(error);

  expect(presented.message).toContain("HTTP 400");
  expect(presented.message).toContain("Wait until status");
  expect(presented.hint).toContain("endpoint is running");
});

test("a body that is not JSON is still reported", () => {
  const error = new APICallError({
    message: "Bad Request",
    url: "https://example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 404,
    responseBody: "no such endpoint",
  });

  expect(presentError(error).message).toContain("no such endpoint");
});
