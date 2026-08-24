import type { Spec } from "./schemas";

export function normalizeSpec(spec: Spec): Spec {
  const requirementIds = new Map(
    spec.requirements.map((item, index) => [item.id, `R${index + 1}`]),
  );
  const requirements = spec.requirements.map((item, index) => ({
    ...item,
    id: `R${index + 1}`,
  }));
  const acceptance = spec.acceptance.map((item, index) => ({
    ...item,
    id: `A${index + 1}`,
    verifies: unique(item.verifies.flatMap((id) => mappedId(requirementIds, id))),
  }));
  const questions = spec.questions.slice(0, 3).map((item, index) => ({
    ...item,
    id: `Q${index + 1}`,
    blocking: true,
  }));
  const subfeatures = spec.subfeatures.map((item, index) => ({
    ...item,
    id: `F${index + 1}`,
  }));
  const status =
    subfeatures.length > 1
      ? "needs_decomposition"
      : questions.length > 0
        ? "needs_clarification"
        : "ready";

  return {
    ...spec,
    status,
    requirements,
    acceptance,
    issues:
      status === "ready"
        ? []
        : spec.issues.map((item, index) => ({
            ...item,
            id: `I${index + 1}`,
            affects: unique(item.affects.flatMap((id) => mappedId(requirementIds, id))),
          })),
    questions: status === "needs_decomposition" ? [] : questions,
    subfeatures: status === "needs_decomposition" ? subfeatures : [],
  };
}

function mappedId(ids: Map<string, string>, id: string): string[] {
  const mapped = ids.get(id);
  return mapped === undefined ? [] : [mapped];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
