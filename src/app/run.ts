import { ModelClient } from "../ai/model-client";
import { parseCli } from "../cli/args";
import { helpText } from "../cli/help";
import { readInput } from "../cli/input";
import { begin, info, required, setUiLanguage, success } from "../cli/ui";
import { initializeUserConfig, loadModelConfig, loadUserEnvironment } from "../config/env";
import { PRODUCT_NAME, VERSION } from "../config/product";
import { classifyRequest } from "../intake/classify";
import { writeImplementationPlan } from "../planning/storage";
import { loadPolicy } from "../policy/load";
import { createApprovedDiscovery } from "../workflows/discovery";
import { runApprovedExecution } from "../workflows/execution";
import { persistGovernance } from "../workflows/governance";
import { runRepositoryInquiry } from "../workflows/inquiry";
import { createApprovedPlan } from "../workflows/planning";
import { createApprovedSpecification } from "../workflows/specification";
import { runDiagnosticStage } from "./stages";

export async function runCli(arguments_: string[]): Promise<void> {
  const cli = parseCli(arguments_);
  if (cli.help) return console.log(helpText());
  if (cli.version) return console.log(`${PRODUCT_NAME} ${VERSION}`);
  if (cli.init) {
    const config = await initializeUserConfig();
    console.log(`${config.created ? "Created" : "Configuration already exists at"} ${config.path}`);
    return;
  }

  await loadUserEnvironment();
  const client = new ModelClient(loadModelConfig(), cli.thinking);
  if (cli.stage) {
    const input = await readInput(cli.input, "Stage input: ");
    const result = await runDiagnosticStage(client, cli.stage, input);
    if (result === undefined) throw new Error(`Unknown stage "${cli.stage}"`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  begin();
  let request = await readInput(cli.input, "Task or question / Задача или вопрос");
  let intent = await classifyRequest(client, request);
  setUiLanguage(intent.language);
  info(
    intent.intent === "inquiry"
      ? { en: "Mode: read-only repository question", ru: "Режим: read-only вопрос о проекте" }
      : intent.intent === "change"
        ? { en: "Mode: controlled project change", ru: "Режим: контролируемое изменение проекта" }
        : { en: "The request needs clarification", ru: "Запрос нужно уточнить" },
  );
  while (intent.intent === "unclear") {
    info({ en: intent.question, ru: intent.question });
    if (!process.stdin.isTTY) return;
    request += `\n\nUser clarification:\n${await required({ en: "Your intent", ru: "Ваше намерение" })}`;
    intent = await classifyRequest(client, request);
    setUiLanguage(intent.language);
  }
  if (intent.intent === "inquiry") {
    await runRepositoryInquiry(client, request, intent.language, process.cwd());
    return;
  }
  const spec = await createApprovedSpecification(client, request);
  if (spec?.status !== "ready") return;

  const root = process.cwd();
  const discovery = await createApprovedDiscovery(client, spec, root);
  const policy = await loadPolicy(root);
  const plan = await createApprovedPlan(client, spec, discovery, policy, root);
  const planPath = await writeImplementationPlan(plan);
  success({ en: `Implementation plan saved to ${planPath}`, ru: `План сохранён: ${planPath}` });
  await persistGovernance(root, spec, discovery, plan, policy);
  await runApprovedExecution(client, root, spec, plan, policy);
}
