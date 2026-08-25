import type { ModelClient } from "../ai/model-client";
import { formatUsage, resetUsage, sessionUsage } from "../ai/usage";
import { document, success, warn } from "../cli/ui";
import { buildImplementationPlan, preparePlanningContext } from "../planning/pipeline";
import { buildTaskList } from "../tasks/pipeline";
import { type EvalCase, loadCorpus, recordCase } from "./corpus";
import { type Candidate, type CaseScore, formatScore, scoreCase, summarize } from "./score";

export type EvalOptions = {
  /** Regenerates the artifacts with the model before scoring, instead of scoring what was recorded. */
  live?: boolean;
  client?: ModelClient;
  root: string;
};

/**
 * `sddc --eval` scores the corpus.
 *
 * Offline it replays recorded artifacts through the validators, which catches a validator change
 * that silently starts rejecting work a user already accepted. `--live` regenerates plan and tasks
 * from the recorded specification, which is what makes a prompt or context change measurable
 * instead of a guess.
 */
export async function runEvals(options: EvalOptions): Promise<boolean> {
  const corpus = await loadCorpus(options.root);
  if (corpus.length === 0) {
    warn({
      en: "No eval cases found. Record one with: sddc --eval-record -- <feature>",
      ru: "Нет случаев для оценки. Запишите первый: sddc --eval-record -- <фича>",
    });
    return false;
  }

  resetUsage();
  const scores: CaseScore[] = [];
  for (const item of corpus) {
    const candidate = options.live ? await regenerate(item, options) : {};
    scores.push(scoreCase(item, candidate));
  }

  const score = summarize(scores);
  document(
    {
      en: options.live ? "Eval · regenerated" : "Eval · recorded",
      ru: options.live ? "Оценка · перегенерация" : "Оценка · записанное",
    },
    formatScore(score),
  );

  const usage = sessionUsage();
  if (usage.calls > 0) {
    const summary = formatUsage(usage);
    document({ en: "Eval cost", ru: "Стоимость оценки" }, summary);
  }

  if (score.passed === score.total) {
    success({
      en: `All ${score.total} cases pass`,
      ru: `Все случаи пройдены: ${score.total}`,
    });
    return true;
  }
  warn({
    en: `${score.total - score.passed} of ${score.total} cases fail`,
    ru: `Не пройдено случаев: ${score.total - score.passed} из ${score.total}`,
  });
  return false;
}

/** Rebuilds plan and tasks from the recorded specification so today's output can be compared. */
async function regenerate(item: EvalCase, options: EvalOptions): Promise<Candidate> {
  const client = options.client;
  if (!client) throw new Error("Live evals require a configured model");
  const repository = await preparePlanningContext(options.root, item.discovery);
  const plan = await buildImplementationPlan(
    client,
    item.spec,
    item.discovery,
    "",
    repository,
    item.policy,
  );
  if (plan.status !== "ready") return { plan };
  const tasks = await buildTaskList(
    client,
    item.spec,
    plan,
    item.discovery,
    "",
    repository,
    item.policy,
  );
  return { plan, tasks };
}

export async function runEvalRecord(root: string, feature: string): Promise<void> {
  if (!feature) throw new Error("Name the feature to record: sddc --eval-record -- <feature>");
  const path = await recordCase(root, feature);
  success({ en: `Case recorded at ${path}`, ru: `Случай записан: ${path}` });
}
