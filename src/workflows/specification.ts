import type { ModelClient } from "../ai/model-client";
import { formatSpec } from "../cli/approval";
import { specSummary } from "../cli/presentation";
import { document, required, reviewDocument, success, withSpinner } from "../cli/ui";
import type { RequestRepositoryContext } from "../repository/request-context";
import { buildSpec } from "../spec/pipeline";
import type { Spec } from "../spec/schemas";
import { writeSpec } from "../spec/storage";

export async function createApprovedSpecification(
  client: ModelClient,
  initialRequest: string,
  repository?: RequestRepositoryContext,
  interactive = process.stdin.isTTY,
): Promise<Spec | null> {
  let request = initialRequest;
  while (true) {
    const spec = await withSpinner(
      { en: "Building specification", ru: "Составляю спецификацию" },
      { en: "Specification analyzed", ru: "Спецификация проанализирована" },
      () => buildSpec(client, request, repository),
    );
    if (!interactive) {
      document({ en: "Draft specification", ru: "Черновик спецификации" }, formatSpec(spec));
      const path = await writeSpec(spec, false);
      success({
        en: `Draft written to ${path}`,
        ru: `Черновик сохранён: ${path}`,
      });
      return null;
    }
    if (spec.status === "needs_clarification") {
      request += "\n\nUser clarifications:\n";
      for (const question of spec.questions) {
        document(
          { en: `Decision needed · ${question.id}`, ru: `Нужно решение · ${question.id}` },
          `${question.question}\n\n${question.reason}`,
        );
        request += `${question.id}: ${await required({ en: "Your answer", ru: "Ваш ответ" })}\n`;
      }
      continue;
    }

    const rendered = formatSpec(spec);
    if (
      (await reviewDocument(
        { en: "Accept this specification?", ru: "Принять эту спецификацию?" },
        { en: "Specification summary", ru: "Краткая спецификация" },
        specSummary(spec),
        rendered,
      )) === "accept"
    ) {
      const path = await writeSpec(spec);
      success({ en: `Specification saved to ${path}`, ru: `Спецификация сохранена: ${path}` });
      return spec;
    }
    const feedback = await required({
      en: "What should be changed?",
      ru: "Что нужно изменить?",
    });
    request += `\n\nRejected specification:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}
