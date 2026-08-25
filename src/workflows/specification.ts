import type { ModelClient } from "../ai/model-client";
import { formatSpec } from "../cli/approval";
import { specDocument, specSummary } from "../cli/presentation";
import { document, success } from "../cli/ui";
import type { Policy } from "../policy/schemas";
import type { RequestRepositoryContext } from "../repository/request-context";
import { buildSpec } from "../spec/pipeline";
import { type Spec, specSchema } from "../spec/schemas";
import { writeSpec } from "../spec/storage";
import { type DialogueContext, initialState } from "./context";
import { converge } from "./dialogue";

export async function createApprovedSpecification(
  client: ModelClient,
  initialRequest: string,
  repository: RequestRepositoryContext | undefined,
  interactive: boolean,
  policy: Policy,
  context: DialogueContext,
  constitution = "",
): Promise<Spec | null> {
  if (!interactive) {
    const spec = await buildSpec(client, initialRequest, repository, policy, constitution);
    document({ en: "Draft requirements", ru: "Черновик требований" }, specDocument(spec));
    const path = await writeSpec(spec, false);
    success({ en: `Draft written to ${path}`, ru: `Черновик сохранён: ${path}` });
    return null;
  }

  const spec = await converge({
    phase: "spec",
    root: context.root,
    request: context.request,
    policy,
    initial: initialState(context, "spec"),
    build: (input) =>
      buildSpec(client, `${initialRequest}${input}`, repository, policy, constitution),
    progress: { en: "Preparing requirements", ru: "Готовлю требования" },
    complete: { en: "Requirements are ready for review", ru: "Требования готовы к проверке" },
    title: { en: "Requirements", ru: "Требования" },
    reviewPrompt: { en: "Accept these requirements?", ru: "Принять эти требования?" },
    revisePrompt: { en: "What should be changed?", ru: "Что нужно изменить?" },
    summary: specSummary,
    details: specDocument,
    render: formatSpec,
    parse: (text) => specSchema.parse(Bun.YAML.parse(text)),
    clarificationHeading: "User clarifications:",
    rejectionHeading: "Rejected specification:",
  });

  const path = await writeSpec(spec);
  success({ en: `Requirements saved to ${path}`, ru: `Требования сохранены: ${path}` });
  return spec;
}
