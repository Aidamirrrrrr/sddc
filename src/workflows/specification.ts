import type { ModelClient } from "../ai/model-client";
import { formatSpec } from "../cli/approval";
import { specDocument, specSummary } from "../cli/presentation";
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
      { en: "Preparing requirements", ru: "Готовлю требования" },
      { en: "Requirements are ready for review", ru: "Требования готовы к проверке" },
      () => buildSpec(client, request, repository),
    );
    if (!interactive) {
      document({ en: "Draft requirements", ru: "Черновик требований" }, specDocument(spec));
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
        { en: "Accept these requirements?", ru: "Принять эти требования?" },
        { en: "Requirements", ru: "Требования" },
        specSummary(spec),
        specDocument(spec),
      )) === "accept"
    ) {
      const path = await writeSpec(spec);
      success({ en: `Requirements saved to ${path}`, ru: `Требования сохранены: ${path}` });
      return spec;
    }
    const feedback = await required({
      en: "What should be changed?",
      ru: "Что нужно изменить?",
    });
    request += `\n\nRejected specification:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}
