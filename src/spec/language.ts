import type { Spec } from "./schemas";

export type ProseLanguage = "Russian" | "English";

/**
 * The language an artifact is written in, inferred from the artifact itself.
 *
 * Deliberately not the interface language: the model writes prose in the language of the request, so
 * a document's own text is the only honest source. Inferring per artifact also means renderers need
 * no language argument threaded through every caller.
 */
export function detectLanguage(...prose: Array<string | undefined>): ProseLanguage {
  return /[А-Яа-яЁё]/.test(prose.filter(Boolean).join(" ")) ? "Russian" : "English";
}

export function specificationLanguage(spec: Spec): ProseLanguage {
  return detectLanguage(
    spec.goal,
    ...spec.requirements.map((item) => item.statement),
    ...spec.acceptance.map((item) => item.statement),
  );
}
