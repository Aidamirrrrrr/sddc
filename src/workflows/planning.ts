import type { ModelClient } from "../ai/model-client";
import { planDocument, planSummary } from "../cli/presentation";
import type { PlanningRepositoryContext } from "../planning/pipeline";
import { buildImplementationPlan } from "../planning/pipeline";
import type { ImplementationPlan } from "../planning/schemas";
import type { Policy } from "../policy/schemas";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import { type DialogueContext, initialState } from "./context";
import { converge } from "./dialogue";

export async function createApprovedPlan(
  client: ModelClient,
  spec: Spec,
  discovery: RepositoryDiscovery,
  policy: Policy,
  repository: PlanningRepositoryContext,
  constitution = "",
  context: DialogueContext,
): Promise<ImplementationPlan> {
  return converge({
    phase: "plan",
    root: context.root,
    request: context.request,
    policy,
    initial: initialState(context, "plan"),
    build: (input) =>
      buildImplementationPlan(client, spec, discovery, input, repository, policy, constitution),
    progress: { en: "Preparing the technical plan", ru: "Готовлю технический план" },
    complete: {
      en: "Technical plan is ready for review",
      ru: "Технический план готов к проверке",
    },
    title: { en: "Technical plan", ru: "Технический план" },
    reviewPrompt: {
      en: "Accept this technical plan?",
      ru: "Принять этот технический план?",
    },
    revisePrompt: {
      en: "What should be changed in the plan?",
      ru: "Что нужно изменить в плане?",
    },
    summary: planSummary,
    details: planDocument,
    render: (plan) => Bun.YAML.stringify(plan, null, 2).trimEnd(),
    clarificationHeading: "User planning clarifications:",
    rejectionHeading: "Rejected implementation plan:",
  });
}
