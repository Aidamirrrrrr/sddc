import type { ModelClient } from "../ai/model-client";
import { planDocument, planSummary } from "../cli/presentation";
import { document, required, reviewDocument, withSpinner } from "../cli/ui";
import { buildImplementationPlan, preparePlanningContext } from "../planning/pipeline";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";

export async function createApprovedPlan(
  client: ModelClient,
  spec: Spec,
  discovery: RepositoryDiscovery,
  policy: Policy,
  root: string,
): Promise<ImplementationPlan> {
  let userInput = "";
  const repository = await preparePlanningContext(root, discovery);
  while (true) {
    const plan = await withSpinner(
      { en: "Preparing the work plan", ru: "Готовлю план работ" },
      { en: "Work plan is ready for review", ru: "План работ готов к проверке" },
      () => buildImplementationPlan(client, spec, discovery, userInput, repository, policy),
    );
    if (plan.status === "needs_clarification") {
      userInput += "\n\nUser planning clarifications:\n";
      for (const question of plan.questions) {
        document(
          { en: `Decision needed · ${question.id}`, ru: `Нужно решение · ${question.id}` },
          `${question.question}\n\n${question.reason}`,
        );
        userInput += `${question.id}: ${await required({ en: "Your answer", ru: "Ваш ответ" })}\n`;
      }
      continue;
    }

    const rendered = Bun.YAML.stringify(plan, null, 2).trimEnd();
    if (
      (await reviewDocument(
        { en: "Accept this work plan?", ru: "Принять этот план работ?" },
        { en: "Work plan", ru: "План работ" },
        planSummary(plan),
        planDocument(plan),
      )) === "accept"
    ) {
      return plan;
    }
    const feedback = await required({
      en: "What should be changed in the plan?",
      ru: "Что нужно изменить в плане?",
    });
    userInput += `\n\nRejected implementation plan:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}
