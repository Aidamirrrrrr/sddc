import type { Spec } from "./schemas";

export function specificationLanguage(spec: Spec): "Russian" | "English" {
  const prose = [
    spec.goal,
    ...spec.requirements.map((item) => item.statement),
    ...spec.acceptance.map((item) => item.statement),
  ].join(" ");
  return /[А-Яа-яЁё]/.test(prose) ? "Russian" : "English";
}
