import { ModelClient } from "../ai/model-client";
import { parseCli } from "../cli/args";
import { helpText } from "../cli/help";
import { readInput } from "../cli/input";
import {
  begin,
  finish,
  info,
  required,
  setOutputMode,
  setUiLanguage,
  step,
  success,
} from "../cli/ui";
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
import { createRequestContext } from "../workflows/request-context";
import { createApprovedSpecification } from "../workflows/specification";
import { runDiagnosticStage } from "./stages";

export async function runCli(arguments_: string[]): Promise<void> {
  const cli = parseCli(arguments_);
  setOutputMode(
    cli.json ? "json" : cli.plain || cli.noInput || !process.stdin.isTTY ? "plain" : "interactive",
  );
  const interactive = process.stdin.isTTY && !cli.noInput;
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
    const input = await readInput(cli.input, "Stage input: ", { noInput: cli.noInput });
    const result = await runDiagnosticStage(client, cli.stage, input);
    if (result === undefined) throw new Error(`Unknown stage "${cli.stage}"`);
    console.log(JSON.stringify(result, null, cli.json ? undefined : 2));
    return;
  }

  begin();
  let request = await readInput(cli.input, "Task or question / Задача или вопрос", {
    noInput: cli.noInput,
  });
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
    if (!interactive) return;
    request += `\n\nUser clarification:\n${await required({ en: "Your intent", ru: "Ваше намерение" })}`;
    intent = await classifyRequest(client, request);
    setUiLanguage(intent.language);
  }
  if (intent.intent === "inquiry") {
    if (!interactive) {
      throw new Error(
        "Repository inquiries require context approval. Run interactively without --no-input.",
      );
    }
    await runRepositoryInquiry(client, request, intent.language, process.cwd());
    return;
  }
  const root = process.cwd();
  step(1, 4, { en: "Repository context", ru: "Контекст проекта" });
  const requestContext = interactive
    ? await createRequestContext(client, request, root)
    : undefined;
  step(2, 4, { en: "Specification", ru: "Спецификация" });
  const spec = await createApprovedSpecification(client, request, requestContext, interactive);
  if (spec?.status !== "ready") return;

  step(3, 4, { en: "Project understanding and plan", ru: "Устройство проекта и план" });
  const discovery = await createApprovedDiscovery(client, spec, root, requestContext);
  const policy = await loadPolicy(root);
  const plan = await createApprovedPlan(client, spec, discovery, policy, root);
  const planPath = await writeImplementationPlan(plan);
  success({ en: `Implementation plan saved to ${planPath}`, ru: `План сохранён: ${planPath}` });
  await persistGovernance(root, spec, discovery, plan, policy);
  if (cli.dryRun) {
    finish({
      en: "Dry run complete; no source files were changed",
      ru: "Пробный запуск завершён; исходные файлы не изменены",
    });
    return;
  }
  step(4, 4, { en: "Controlled implementation", ru: "Контролируемая реализация" });
  await runApprovedExecution(client, root, spec, plan, policy);
}
