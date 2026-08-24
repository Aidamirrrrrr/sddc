import type { ModelClient } from "../ai/model-client";
import { formatSpec } from "../cli/approval";
import { document, required, review, success, withSpinner } from "../cli/ui";
import { buildSpec } from "../spec/pipeline";
import type { Spec } from "../spec/schemas";
import { writeSpec } from "../spec/storage";

export async function createApprovedSpecification(
  client: ModelClient,
  initialRequest: string,
): Promise<Spec | null> {
  let request = initialRequest;
  while (true) {
    const spec = await withSpinner(
      { en: "Building specification", ru: "Составляю спецификацию" },
      { en: "Specification analyzed", ru: "Спецификация проанализирована" },
      () => buildSpec(client, request),
    );
    if (!process.stdin.isTTY) {
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
          { en: `Question ${question.id}`, ru: `Вопрос ${question.id}` },
          `${question.question}\n\n${question.reason}`,
        );
        request += `${question.id}: ${await required({ en: "Your answer", ru: "Ваш ответ" })}\n`;
      }
      continue;
    }

    const rendered = formatSpec(spec);
    document({ en: "Specification", ru: "Спецификация" }, rendered);
    if (
      (await review({ en: "Accept this specification?", ru: "Принять эту спецификацию?" })) ===
      "accept"
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
