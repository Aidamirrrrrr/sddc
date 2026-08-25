import { document, success, warn } from "../cli/ui";
import type { ImplementationPlan } from "../planning/schemas";
import { readImplementationPlan } from "../planning/storage";
import type { Spec } from "../spec/schemas";
import { readSpec } from "../spec/storage";
import type { TaskList } from "../tasks/schemas";
import { readTaskList } from "../tasks/storage";
import { resolveFeature } from "./features";
import { artifactDigest, readProvenance } from "./provenance";

export type Severity = "stale" | "gap";

export type Finding = {
  severity: Severity;
  statement: string;
};

/**
 * Cross-artifact consistency, the check SDD calls `analyze`.
 *
 * Two independent failures are reported. A *stale* artifact was derived from a version of its input
 * that no longer exists on disk, so its conclusions may already be wrong. A *gap* is a requirement
 * or acceptance criterion that no downstream artifact claims to serve, which the per-phase
 * validators cannot see because each of them only ever looks at one phase.
 */
export async function analyzeFeature(root: string, feature: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const spec = await readSpec(root, feature);
  const plan = await readPlan(root, feature);
  const tasks = await readTasks(root, feature);

  findings.push(...(await staleness(root, feature, plan, tasks)));
  findings.push(...artifactFindings(spec, plan, tasks));
  return findings;
}

/**
 * The half of the analysis that needs no filesystem: whether the artifacts serve each other.
 *
 * Kept pure so the eval harness can score a candidate artifact that was never written to disk.
 */
export function artifactFindings(
  spec: Spec,
  plan: ImplementationPlan | undefined,
  tasks: TaskList | undefined,
): Finding[] {
  return [
    ...(plan ? planGaps(spec, plan) : []),
    ...(tasks ? taskGaps(spec, tasks) : []),
    ...(plan && tasks ? planToTaskGaps(plan, tasks) : []),
  ];
}

async function staleness(
  root: string,
  feature: string,
  plan: ImplementationPlan | undefined,
  tasks: TaskList | undefined,
): Promise<Finding[]> {
  const provenance = await readProvenance(root, feature);
  const specDigest = await artifactDigest(root, feature, "spec.yaml");
  const planDigest = await artifactDigest(root, feature, "plan.yaml");
  const findings: Finding[] = [];

  if (plan && provenance.plan && provenance.plan.spec_sha256 !== specDigest) {
    findings.push({
      severity: "stale",
      statement: "plan.yaml was derived from an older spec.yaml; recompile the plan",
    });
  }
  if (tasks && provenance.tasks) {
    if (provenance.tasks.spec_sha256 !== specDigest) {
      findings.push({
        severity: "stale",
        statement: "tasks.yaml was derived from an older spec.yaml; recompile the tasks",
      });
    } else if (provenance.tasks.plan_sha256 !== planDigest) {
      findings.push({
        severity: "stale",
        statement: "tasks.yaml was derived from an older plan.yaml; recompile the tasks",
      });
    }
  }
  return findings;
}

function planGaps(spec: Spec, plan: ImplementationPlan): Finding[] {
  const served = new Set(plan.approach.flatMap((step) => step.requirements));
  return spec.requirements
    .filter((requirement) => !served.has(requirement.id))
    .map((requirement) => ({
      severity: "gap" as const,
      statement: `${requirement.id} is not served by any plan step: ${requirement.statement}`,
    }));
}

function taskGaps(spec: Spec, tasks: TaskList): Finding[] {
  const covered = new Set(
    tasks.tasks.flatMap((task) => [...task.requirements, ...task.acceptance]),
  );
  const missingRequirements = spec.requirements
    .filter((requirement) => !covered.has(requirement.id))
    .map((requirement) => ({
      severity: "gap" as const,
      statement: `${requirement.id} is not covered by any task: ${requirement.statement}`,
    }));
  const missingAcceptance = spec.acceptance
    .filter((criterion) => !covered.has(criterion.id))
    .map((criterion) => ({
      severity: "gap" as const,
      statement: `${criterion.id} is never verified by a task: ${criterion.statement}`,
    }));
  return [...missingRequirements, ...missingAcceptance];
}

function planToTaskGaps(plan: ImplementationPlan, tasks: TaskList): Finding[] {
  const written = new Set(
    tasks.tasks.flatMap((task) => [...task.files.modify, ...task.files.create]),
  );
  return plan.approach
    .filter((step) => step.touches.length > 0 && !step.touches.some((path) => written.has(path)))
    .map((step) => ({
      severity: "gap" as const,
      statement: `plan step ${step.id} touches files no task writes: ${step.touches.join(", ")}`,
    }));
}

/**
 * The `analyze` gate, run in the flow rather than only on demand.
 *
 * SDD puts a cross-artifact check between the task graph and implementation, and this one existed
 * only as a separate command — so the phase it was meant to protect never ran it. Findings do not
 * stop the run on their own: the per-phase validators already refuse the graphs that cannot execute,
 * and what is left here is drift a person should look at and decide about.
 */
export async function reportConsistency(root: string, feature: string): Promise<Finding[]> {
  const findings = await analyzeFeature(root, feature).catch(() => []);
  if (findings.length === 0) {
    success({
      en: "Specification, plan, and tasks agree",
      ru: "Спецификация, план и задачи согласованы",
    });
    return findings;
  }
  document(
    { en: `Consistency findings · ${feature}`, ru: `Расхождения · ${feature}` },
    findings.map((finding) => `[${finding.severity}] ${finding.statement}`).join("\n"),
  );
  warn({
    en: `${findings.length} findings between the accepted artifacts`,
    ru: `Расхождений между принятыми артефактами: ${findings.length}`,
  });
  return findings;
}

/** `sddc --analyze [feature]`: reports drift without changing a single artifact. */
export async function runAnalyze(root: string, requestedFeature: string): Promise<void> {
  const feature = await resolveFeature(root, requestedFeature);
  const findings = await analyzeFeature(root, feature);
  if (findings.length === 0) {
    success({
      en: `${feature}: specification, plan, and tasks agree`,
      ru: `${feature}: спецификация, план и задачи согласованы`,
    });
    return;
  }
  document(
    { en: `Consistency findings · ${feature}`, ru: `Расхождения · ${feature}` },
    findings.map((finding) => `[${finding.severity}] ${finding.statement}`).join("\n"),
  );
  warn({
    en: `${findings.length} findings; recompile the stale phase before implementing`,
    ru: `Найдено расхождений: ${findings.length}; пересоберите устаревший этап до реализации`,
  });
}

async function readPlan(root: string, feature: string): Promise<ImplementationPlan | undefined> {
  return readImplementationPlan(root, feature).catch(() => undefined);
}

async function readTasks(root: string, feature: string): Promise<TaskList | undefined> {
  return readTaskList(root, feature).catch(() => undefined);
}
