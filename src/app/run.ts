import { basename } from "node:path";
import { budgetState, onBudgetWarning, setBudget } from "../ai/budget";
import { InterruptedError, resetInterrupt } from "../ai/interrupt";
import { ModelClient } from "../ai/model-client";
import { formatUsage, resetUsage, sessionUsage } from "../ai/usage";
import { writeQuickstart } from "../artifacts/storage";
import { parseCli } from "../cli/args";
import { presentError } from "../cli/errors";
import { helpText } from "../cli/help";
import { readInput } from "../cli/input";
import {
  banner,
  begin,
  chooseUiLanguage,
  finish,
  info,
  phrase,
  required,
  setOutputMode,
  setUiLanguage,
  step,
  success,
  warn,
} from "../cli/ui";
import {
  initializeUserConfig,
  loadInputPrice,
  loadModelConfig,
  loadUserEnvironment,
} from "../config/env";
import { PRODUCT_NAME, VERSION } from "../config/product";
import { runEvalRecord, runEvals } from "../evals/run";
import { classifyRequest } from "../intake/classify";
import { preparePlanningContext } from "../planning/pipeline";
import { writeImplementationPlan } from "../planning/storage";
import { loadConstitution } from "../policy/constitution";
import { loadPolicy } from "../policy/load";
import { indexRepository } from "../repository/scan";
import { writeTaskList } from "../tasks/storage";
import { driver } from "../ui/driver";
import { detectTheme, setTheme } from "../ui/theme";
import { reportConsistency, runAnalyze } from "../workflows/analyze";
import type { DialogueContext } from "../workflows/context";
import { createApprovedDiscovery } from "../workflows/discovery";
import { runApprovedExecution } from "../workflows/execution";
import { persistGovernance } from "../workflows/governance";
import { runRepositoryInquiry } from "../workflows/inquiry";
import { createApprovedPlan } from "../workflows/planning";
import { recordPlanProvenance, recordTaskProvenance } from "../workflows/provenance";
import { runRecompile } from "../workflows/recompile";
import { createRequestContext } from "../workflows/request-context";
import { clearSession, hasRecordedAnswers, loadSession, userAnswers } from "../workflows/session";
import { createApprovedSpecification } from "../workflows/specification";
import { createApprovedTaskList } from "../workflows/tasks";
import { runDiagnosticStage } from "./stages";

export async function runCli(arguments_: string[]): Promise<void> {
  const cli = parseCli(arguments_);
  const interactive = process.stdin.isTTY && !cli.noInput;
  // Help, version, init and the diagnostic stages print plain text; mounting the app over them would
  // only take the terminal away from output the user asked to read.
  const chrome = interactive && !cli.help && !cli.version && !cli.init && !cli.stage;
  setOutputMode(
    cli.json
      ? "json"
      : cli.plain || cli.noInput || !process.stdin.isTTY
        ? "plain"
        : chrome
          ? "app"
          : "interactive",
  );
  if (cli.help) return console.log(helpText());
  if (cli.version) return console.log(`${PRODUCT_NAME} ${VERSION}`);
  if (cli.init) {
    const config = await initializeUserConfig();
    console.log(`${config.created ? "Created" : "Configuration already exists at"} ${config.path}`);
    return;
  }

  // Loaded before the language is settled: SDDC_LANG lives in the user config, and reading it after
  // the prompt would mean asking a question the user has already answered.
  await loadUserEnvironment();
  // Chosen before anything is drawn: a palette applied mid-run would repaint the live frame while
  // leaving everything already committed to the scrollback in the previous one.
  setTheme(detectTheme());
  if (!cli.stage) begin();
  if (interactive && !cli.stage) await chooseUiLanguage(cli.language);
  else setUiLanguage(cli.language ?? (/^ru/i.test(process.env.LANG ?? "") ? "ru" : "en"));
  const modelConfig = loadModelConfig();
  const client = new ModelClient(modelConfig, cli.thinking);
  // Set before the first stage runs, so intake is inside the ceiling rather than outside it. The
  // project's policy is the source; the flag overrides it for one invocation.
  const runPolicy = await loadPolicy(process.cwd());
  setBudget(cli.maxCalls ?? runPolicy.budget.max_model_calls);
  onBudgetWarning((used, limit) =>
    warn({
      en: `${used} of ${limit} model calls used in this run`,
      ru: `Израсходовано вызовов модели: ${used} из ${limit}`,
    }),
  );
  if (cli.stage) {
    const input = await readInput(cli.input, "Stage input: ", { noInput: cli.noInput });
    const result = await runDiagnosticStage(client, cli.stage, input);
    if (result === undefined) throw new Error(`Unknown stage "${cli.stage}"`);
    console.log(JSON.stringify(result, null, cli.json ? undefined : 2));
    return;
  }

  if (!cli.stage) {
    banner({
      version: VERSION,
      project: basename(process.cwd()),
      model: modelConfig.model,
      facts: [
        phrase({
          en: `budget   ${cli.maxCalls ?? runPolicy.budget.max_model_calls} model calls`,
          ru: `бюджет   ${cli.maxCalls ?? runPolicy.budget.max_model_calls} вызовов модели`,
        }),
        phrase(
          runPolicy.changes.require_test_before_implementation
            ? { en: "rules    test-first enforced", ru: "правила  сначала тест" }
            : { en: "rules    test-first off", ru: "правила  test-first выключен" },
        ),
      ],
    });
  }

  // Walked in the background: the prompt is usable immediately and gains `@` completion when the
  // index arrives. A project too large or unreadable to walk simply never offers them.
  void indexRepository(process.cwd())
    .then((files) => driver().offerPaths?.(files.map((file) => file.path)))
    .catch(() => undefined);

  if (cli.analyze) {
    return runAnalyze(process.cwd(), cli.input.join(" ").trim());
  }

  if (cli.evalRecord) {
    return runEvalRecord(process.cwd(), cli.input.join(" ").trim());
  }

  if (cli.evaluate) {
    const passing = await runEvals({ root: process.cwd(), live: cli.live, client });
    // A failing corpus is a failing command, so this can gate a commit.
    if (!passing) process.exitCode = 1;
    return;
  }

  if (cli.recompile) {
    return runRecompile(
      client,
      process.cwd(),
      cli.recompile,
      cli.input.join(" ").trim(),
      cli.dryRun,
    );
  }

  // One request, start to finish. Extracted so the surface that can wait at a prompt may ask for
  // another one afterwards instead of the process being the unit of work.
  async function handleRequest(initial: string): Promise<void> {
    let request = initial;
    let intent = await classifyRequest(client, request);
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
    const policy = runPolicy;
    const session = await loadSession(root, request);
    if (interactive && hasRecordedAnswers(session)) {
      info({
        en: "Resuming with the answers recorded for this request",
        ru: "Продолжаю с ответами, записанными для этого запроса",
      });
    }
    const context: DialogueContext = { root, request, session };

    step(1, 5, { en: "Choose source access", ru: "Выбор доступа к коду" });
    const requestContext = interactive
      ? await createRequestContext(client, request, root)
      : undefined;
    step(2, 5, { en: "Agree on requirements", ru: "Согласование требований" });
    // Loaded before the first phase that could contradict it, not just before planning.
    const constitution = await loadConstitution(root);
    const spec = await createApprovedSpecification(
      client,
      request,
      requestContext,
      interactive,
      policy,
      context,
      constitution,
    );
    if (spec?.status !== "ready") return;

    step(3, 5, { en: "Map the project and plan the work", ru: "Карта проекта и план работ" });
    const discovery = await createApprovedDiscovery(client, spec, root, requestContext);
    const repository = await preparePlanningContext(root, discovery);
    const plan = await createApprovedPlan(
      client,
      spec,
      discovery,
      policy,
      repository,
      constitution,
      context,
    );
    const planPath = await writeImplementationPlan(plan);
    await recordPlanProvenance(root, spec.feature);
    success({ en: `Technical plan saved to ${planPath}`, ru: `План сохранён: ${planPath}` });

    step(4, 5, { en: "Derive the task graph", ru: "Граф задач" });
    const tasks = await createApprovedTaskList(
      client,
      spec,
      plan,
      discovery,
      policy,
      repository,
      constitution,
      context,
    );
    const tasksPath = await writeTaskList(tasks, root);
    await recordTaskProvenance(root, spec.feature);
    await writeQuickstart(root, spec, tasks);
    success({ en: `Task graph saved to ${tasksPath}`, ru: `Граф задач сохранён: ${tasksPath}` });
    await persistGovernance(root, spec, discovery, plan, tasks, policy);
    // The artifacts record what was decided; only the session holds the user's own words. Read them
    // out before the conversation is cleared, so the implementation phase still has them.
    const clarifications = userAnswers(await loadSession(root, request));
    await clearSession(root);
    // SDD's analyze step: the artifacts are accepted, so this is the last moment they can be compared
    // with each other before anything is built from them — a dry run wants it most of all.
    await reportConsistency(root, spec.feature);
    if (cli.dryRun) {
      reportUsage();
      finish({
        en: "Dry run complete; no source files were changed",
        ru: "Пробный запуск завершён; исходные файлы не изменены",
      });
      return;
    }
    step(5, 5, { en: "Controlled implementation", ru: "Контролируемая реализация" });
    await runApprovedExecution(client, root, spec, plan, tasks, policy, {
      constitution,
      clarifications,
    });
    reportUsage();
  }

  const prompt = driver().nextRequest?.bind(driver());
  if (!prompt) {
    await handleRequest(
      await readInput(cli.input, "Task or question / Задача или вопрос", {
        noInput: cli.noInput,
      }),
    );
    return;
  }

  // The prompt outlives a run here, so the session is the unit rather than the process: finish a
  // feature and the line comes back asking for the next one.
  let first = cli.input.join(" ").trim();
  while (true) {
    const request = first || (await prompt());
    first = "";
    // Each feature gets its own ceiling, its own counters and its own clean interrupt. Carrying any
    // of them across would make the second request answer for the first one's spending — and would
    // print a closing line whose two halves counted different things.
    setBudget(cli.maxCalls ?? runPolicy.budget.max_model_calls);
    resetUsage();
    resetInterrupt();
    try {
      await handleRequest(request);
    } catch (error) {
      if (error instanceof InterruptedError) {
        warn({ en: "Stopped.", ru: "Остановлено." });
        continue;
      }
      const { message, hint } = presentError(error);
      warn({ en: message, ru: message });
      if (hint) info({ en: hint, ru: hint });
    }
  }
}

/** Closes the run with what it cost, including how much of the input the provider served from cache. */
function reportUsage(): void {
  const usage = sessionUsage();
  if (usage.calls === 0) return;
  const budget = budgetState();
  // Reported every run, not only when it bites: a share the user watches is a share they can size.
  const share = budget
    ? phrase({
        en: ` · ${budget.used} of ${budget.limit} call budget`,
        ru: ` · ${budget.used} из ${budget.limit} бюджета вызовов`,
      })
    : "";
  const summary = `${formatUsage(usage, loadInputPrice())}${share}`;
  info({ en: summary, ru: summary });
}
