import type { ModelClient } from "../ai/model-client";
import { planDocument, planSummary } from "../cli/presentation";
import { document, required, reviewDocument, withSpinner } from "../cli/ui";
import type { PlanningRepositoryContext } from "../planning/pipeline";
import { buildImplementationPlan } from "../planning/pipeline";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";

export async function createApprovedPlan(
  client: ModelClient,
  spec: Spec,
  discovery: RepositoryDiscovery,
  policy: Policy,
  repository: PlanningRepositoryContext,
  constitution = "",
): Promise<ImplementationPlan> {
  let userInput = "";
  while (true) {
    const plan = await withSpinner(
      { en: "Preparing the technical plan", ru: "Готовлю технический план" },
      { en: "Technical plan is ready for review", ru: "Технический план готов к проверке" },
      () =>
        buildImplementationPlan(
          client,
          spec,
          discovery,
          userInput,
          repository,
          policy,
          constitution,
        ),
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
        { en: "Accept this technical plan?", ru: "Принять этот технический план?" },
        { en: "Technical plan", ru: "Технический план" },
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
