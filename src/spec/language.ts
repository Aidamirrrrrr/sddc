import type { Spec } from "./schemas";

export type ProseLanguage = "Russian" | "English";

/**
 * The language an artifact is written in, inferred from the artifact itself.
 *
 * Deliberately not the interface language: the model writes prose in the language of the request, so
 * a document's own text is the only honest source. Inferring per artifact also means renderers need
 * no language argument threaded through every caller.
 */
/**
 * Any Cyrillic at all used to mean Russian, so one quoted identifier or error string from a Russian
 * codebase flipped an English document — and the label decides what language the next stage writes
 * in. A share of the letters is the honest test: a stray literal cannot outvote the prose it sits in.
 */
const RUSSIAN_LETTER_SHARE = 0.1;

export function detectLanguage(...prose: Array<string | undefined>): ProseLanguage {
  const text = prose.filter(Boolean).join(" ");
  const cyrillic = text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (cyrillic === 0) return "English";
  return cyrillic / (cyrillic + latin) > RUSSIAN_LETTER_SHARE ? "Russian" : "English";
}

export function specificationLanguage(spec: Spec): ProseLanguage {
  return detectLanguage(
    spec.goal,
    ...spec.requirements.map((item) => item.statement),
    ...spec.acceptance.map((item) => item.statement),
  );
}
