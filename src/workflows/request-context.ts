import type { ModelClient } from "../ai/model-client";
import { type Copy, info, success, withSpinner } from "../cli/ui";
import { loadInputPrice } from "../config/env";
import { createRepositoryContextSelector } from "../repository/context-selector";
import {
  prepareRequestRepositoryContext,
  type RequestContextStage,
  type RequestRepositoryContext,
} from "../repository/request-context";

export async function createRequestContext(
  client: ModelClient,
  request: string,
  root: string,
): Promise<RequestRepositoryContext> {
  info({
    en: "Select context before specification",
    ru: "Выберите контекст до составления спецификации",
  });
  const context = await prepareRequestRepositoryContext(
    client,
    request,
    root,
    createRepositoryContextSelector(root, { inputUsdPerMillion: loadInputPrice() }),
    (stage, operation) => withSpinner(...stageCopy(stage), operation),
  );
  success({
    en: `${context.snapshots.length} files approved for specification`,
    ru: `Для спецификации подтверждено файлов: ${context.snapshots.length}`,
  });
  return context;
}

function stageCopy(stage: RequestContextStage): [Copy, Copy] {
  return stage === "select"
    ? [
        { en: "Finding code related to the request", ru: "Ищу связанный с запросом код" },
        { en: "Initial context suggested", ru: "Начальный контекст предложен" },
      ]
    : [
        { en: "Checking definitions and usages", ru: "Проверяю определения и использования" },
        { en: "Context coverage checked", ru: "Полнота контекста проверена" },
      ];
}
