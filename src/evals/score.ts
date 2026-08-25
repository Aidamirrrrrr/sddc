import type { ImplementationPlan } from "../planning/schemas";
import { validatePlan } from "../planning/validate";
import { validateTaskPolicy } from "../policy/validate";
import { validateSpec } from "../spec/validate";
import type { TaskList } from "../tasks/schemas";
import { validateTaskList } from "../tasks/validate";
import { artifactFindings } from "../workflows/analyze";
import type { EvalCase } from "./corpus";

/**
 * Scoring reuses the pipeline's own validators rather than inventing a rubric.
 *
 * They already encode what "correct" means here, they cannot be argued with, and they run without a
 * model. That makes them a regression net now and a reward signal later.
 */
export type Check = { id: string; passed: boolean; detail: string };

export type CaseScore = {
  name: string;
  checks: Check[];
  /** Coverage gaps between artifacts: not failures, but the number should not grow. */
  findings: number;
  passed: boolean;
};

export type Candidate = { plan?: ImplementationPlan; tasks?: TaskList };

/**
 * Scores a case, optionally against freshly generated artifacts instead of the recorded ones. That
 * is the whole point of the harness: swap in what the model produces today and compare.
 */
export function scoreCase(item: EvalCase, candidate: Candidate = {}): CaseScore {
  const plan = candidate.plan ?? item.plan;
  const tasks = candidate.tasks ?? item.tasks;
  const repositoryPaths = item.discovery.context.files;
  const checks: Check[] = [];

  checks.push(check("spec-valid", () => validateSpec(item.spec)));
  if (plan) {
    checks.push(check("plan-valid", () => validatePlan(plan, item.spec, item.discovery)));
  }
  if (tasks) {
    checks.push(
      check("tasks-valid", () =>
        validateTaskList(tasks, item.spec, item.discovery, repositoryPaths),
      ),
    );
    checks.push(check("tasks-policy", () => validateTaskPolicy(tasks.tasks, item.policy)));
  }

  const findings = artifactFindings(item.spec, plan, tasks).length;
  return { name: item.name, checks, findings, passed: checks.every((entry) => entry.passed) };
}

export type CorpusScore = {
  cases: CaseScore[];
  passed: number;
  total: number;
  findings: number;
};

export function summarize(scores: CaseScore[]): CorpusScore {
  return {
    cases: scores,
    passed: scores.filter((score) => score.passed).length,
    total: scores.length,
    findings: scores.reduce((sum, score) => sum + score.findings, 0),
  };
}

export function formatScore(score: CorpusScore): string {
  const lines = score.cases.map((item) => {
    const failed = item.checks.filter((entry) => !entry.passed);
    const head = `${item.passed ? "✓" : "✗"}  ${item.name}`;
    const detail = failed.map((entry) => `      ${entry.id}: ${entry.detail}`);
    const gaps = item.findings > 0 ? [`      ${item.findings} coverage findings`] : [];
    return [head, ...detail, ...gaps].join("\n");
  });
  return [
    ...lines,
    "",
    `${score.passed}/${score.total} cases pass · ${score.findings} coverage findings`,
  ].join("\n");
}

function check(id: string, assertion: () => void): Check {
  try {
    assertion();
    return { id, passed: true, detail: "" };
  } catch (error) {
    return { id, passed: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
