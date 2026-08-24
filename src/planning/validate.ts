import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import type { ImplementationPlan, PlanReview } from "./schemas";

export function normalizePlan(plan: ImplementationPlan, feature: string): ImplementationPlan {
  return {
    ...plan,
    feature,
    approach: plan.approach.map((step, index) => ({
      ...step,
      id: `S${index + 1}`,
      requirements: unique(step.requirements),
      touches: unique(step.touches),
    })),
    questions: plan.questions.map((question, index) => ({
      ...question,
      id: `Q${index + 1}`,
      blocking: true,
    })),
  };
}

export function validatePlan(
  plan: ImplementationPlan,
  spec: Spec,
  discovery: RepositoryDiscovery,
): void {
  if (plan.feature !== spec.feature) throw new Error("Plan feature does not match specification");
  if (plan.status === "needs_clarification") {
    if (plan.questions.length === 0) throw new Error("Clarification plan has no questions");
  } else if (plan.questions.length > 0) {
    throw new Error("Ready plan must not contain questions");
  }

  const approvedFiles = new Set(discovery.context.files);
  for (const decision of plan.decisions) {
    const unsupported = decision.evidence.find((path) => !approvedFiles.has(path));
    if (unsupported)
      throw new Error(`Plan decision references unapproved evidence: ${unsupported}`);
  }

  const requirements = new Set(spec.requirements.map((item) => item.id));
  const covered = new Set<string>();
  for (const step of plan.approach) {
    const invalid = step.requirements.find((id) => !requirements.has(id));
    if (invalid) throw new Error(`${step.id} references unknown requirement: ${invalid}`);
    for (const id of step.requirements) covered.add(id);
  }
  if (plan.status === "ready") {
    const missing = [...requirements].filter((id) => !covered.has(id));
    if (missing.length > 0)
      throw new Error(`Plan approach does not cover requirements: ${missing.join(", ")}`);
  }
}

export function validatePlanReview(review: PlanReview): void {
  const passed = new Set(review.checks.filter((check) => check.passed).map((check) => check.id));
  const missing = Array.from({ length: 6 }, (_, index) => `C${index + 1}`).filter(
    (id) => !passed.has(id),
  );
  if (missing.length > 0) throw new Error(`Plan review failed checks: ${missing.join(", ")}`);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
