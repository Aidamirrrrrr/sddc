export const inquiryPrompts = {
  select: `Select repository files needed to answer the user's read-only question. The input contains
the question and a safe path/size index. Select only paths from the index. Prefer directly related
implementation, tests, configuration, entry points, and manifests. Select at most 24 files and give
a short reason for each. Do not answer the question or propose changes. Return JSON only.`,

  expand: `Find only additional indexed files needed to answer the user's question after reviewing
the approved snapshots. Do not request a path already present in currentSnapshots. Select at most
eight files and return an empty files array when context is sufficient. Do not propose changes.
Return JSON only.`,

  answer: `Answer the user's read-only question about an existing repository. Use only the supplied
file snapshots and explicit user context. Do not invent behavior, architecture, or missing details.
Do not propose or implement changes. Explain the actual flow and important edge cases relevant to the
question. Every repository claim must be represented by an evidence item whose path is supplied.
Put unresolved facts in unknowns. Write all prose in outputLanguage. Return JSON only.`,

  review: `Review and correct a read-only repository answer. Use only the supplied snapshots. Remove
unsupported claims, guessed behavior, implementation proposals, and evidence paths absent from the
snapshots. Preserve useful detail and explicit uncertainty. Write all prose in outputLanguage and
return the complete corrected answer as JSON only.`,
} as const;
