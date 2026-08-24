import type { ModelClient } from "../ai/model-client";
import { type Copy, document, finish, withSpinner } from "../cli/ui";
import { loadInputPrice } from "../config/env";
import { answerRepositoryInquiry, type InquiryStage } from "../inquiry/pipeline";
import { createRepositoryContextSelector } from "../repository/context-selector";

export async function runRepositoryInquiry(
  client: ModelClient,
  request: string,
  language: string,
  root: string,
): Promise<void> {
  const answer = await answerRepositoryInquiry(
    client,
    request,
    language,
    root,
    createRepositoryContextSelector(root, { inputUsdPerMillion: loadInputPrice() }),
    (stage, operation) => withSpinner(...stageCopy(stage), operation),
  );
  document({ en: "Answer", ru: "Ответ" }, answer.answer);
  document(
    { en: "Evidence", ru: "Подтверждения" },
    answer.evidence.map((item) => `${item.path}\n  ${item.finding}`).join("\n\n"),
  );
  if (answer.unknowns.length > 0) {
    document(
      { en: "Unknowns", ru: "Что осталось неизвестным" },
      answer.unknowns.map((item) => `- ${item}`).join("\n"),
    );
  }
  finish({ en: "Repository was not modified", ru: "Репозиторий не изменялся" });
}

function stageCopy(stage: InquiryStage): [Copy, Copy] {
  const copies = {
    select: [
      { en: "Finding relevant files", ru: "Ищу связанные файлы" },
      { en: "Suggested repository context", ru: "Контекст репозитория предложен" },
    ],
    expand: [
      { en: "Checking context coverage", ru: "Проверяю полноту контекста" },
      { en: "Context coverage checked", ru: "Полнота контекста проверена" },
    ],
    answer: [
      { en: "Tracing project behavior", ru: "Разбираю поведение проекта" },
      { en: "Draft answer prepared", ru: "Черновик ответа готов" },
    ],
    review: [
      { en: "Verifying claims against files", ru: "Сверяю выводы с файлами" },
      { en: "Answer verified", ru: "Ответ проверен" },
    ],
  } satisfies Record<InquiryStage, [Copy, Copy]>;
  return copies[stage];
}
