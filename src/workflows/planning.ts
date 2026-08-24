import type { ModelClient } from "../ai/model-client";
import { askRequired, askReviewDecision } from "../cli/review";
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
    console.log("Building implementation plan...");
    const plan = await buildImplementationPlan(
      client,
      spec,
      discovery,
      userInput,
      repository,
      policy,
    );
    if (plan.status === "needs_clarification") {
      userInput += "\n\nUser planning clarifications:\n";
      for (const question of plan.questions) {
        console.log(`- ${question.question}`);
        console.log(`  ${question.reason}`);
        userInput += `${question.id}: ${await askRequired("> ")}\n`;
      }
      continue;
    }

    const rendered = Bun.YAML.stringify(plan, null, 2).trimEnd();
    console.log(`\n${rendered}\n`);
    if ((await askReviewDecision("Accept implementation plan? [a]ccept/[r]evise: ")) === "accept") {
      return plan;
    }
    const feedback = await askRequired("What should be changed in the plan? ");
    userInput += `\n\nRejected implementation plan:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}
