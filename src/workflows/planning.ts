import type { ModelClient } from "../ai/model-client";
import { document, required, review, withSpinner } from "../cli/ui";
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
      { en: "Building implementation plan", ru: "Составляю план реализации" },
      { en: "Implementation plan analyzed", ru: "План реализации проанализирован" },
      () => buildImplementationPlan(client, spec, discovery, userInput, repository, policy),
    );
    if (plan.status === "needs_clarification") {
      userInput += "\n\nUser planning clarifications:\n";
      for (const question of plan.questions) {
        document(
          { en: `Planning question ${question.id}`, ru: `Вопрос по плану ${question.id}` },
          `${question.question}\n\n${question.reason}`,
        );
        userInput += `${question.id}: ${await required({ en: "Your answer", ru: "Ваш ответ" })}\n`;
      }
      continue;
    }

    const rendered = Bun.YAML.stringify(plan, null, 2).trimEnd();
    document({ en: "Implementation plan", ru: "План реализации" }, rendered);
    if ((await review({ en: "Accept this plan?", ru: "Принять этот план?" })) === "accept") {
      return plan;
    }
    const feedback = await required({
      en: "What should be changed in the plan?",
      ru: "Что нужно изменить в плане?",
    });
    userInput += `\n\nRejected implementation plan:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}
