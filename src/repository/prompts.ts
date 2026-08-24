export const repositoryPrompts = {
  requestSelect: `Select repository files needed to understand a requested project change before a
specification is written. The input contains the original request and a safe path/size index. Select
only indexed paths. Prefer named files and symbols, their definitions and usages, adjacent tests,
module wiring, and relevant configuration. Select at most 12 files with a short reason for each. Do
not write requirements or design a solution. Return JSON only.`,

  requestExpand: `Review approved snapshots for an original project-change request and request only
additional indexed files needed to understand existing contracts, usages, tests, and constraints.
Do not request paths already supplied. Select at most six files and return an empty files array
when context is sufficient. Do not write requirements or design a solution. Return JSON only.`,

  select: `Select repository files that are most useful for understanding how an accepted product
specification fits the existing codebase. The input contains the specification and a path/size index.
Select only paths present in the index. Prefer manifests, configuration, entry points, architecture
boundaries, directly related modules, tests, and local documentation. Avoid redundant files. Select
at most 24 files, give a short reason for every selected file, and do not design a solution. Return
JSON only.`,

  expand: `Review the initial repository snapshots against the accepted specification and the full
safe file index. Request only additional files needed to resolve important structural or behavioral
unknowns. Do not request files already present in currentSnapshots. Select at most 8 additional
paths, give a short reason for each, and return an empty files array when the current context is
sufficient. Do not design a solution. Return JSON only.`,

  discover: `Produce a read-only repository discovery report for an accepted product specification.
Use only the supplied file snapshots. Every claim about technology, structure, conventions, tests,
or constraints must cite one or more supplied paths in evidence. User context is an explicit user
statement, not repository evidence. relevant_files.path must be a
supplied path. Symbols must appear in that file; omit uncertain symbols. Do not propose architecture,
implementation steps, files to create, or product behavior. Record missing knowledge in unknowns
instead of guessing. Copy the supplied snapshot paths and user context into context. Write prose in
outputLanguage. Return JSON only.`,

  review: `Act as a strict evidence reviewer for a repository discovery report.
Correct the candidate using only the supplied file snapshots. Remove unsupported technologies,
symbols, conventions, assumptions, recommendations, and implementation plans. Every evidence path
and relevant file path must exist in the supplied snapshots. Preserve uncertainty in unknowns.
Preserve the supplied paths and user context in context. Write prose in outputLanguage and return the
corrected report as JSON only.`,

  revise: `Revise a repository discovery report using the user's feedback. Use only the supplied file
snapshots for repository claims. User feedback may correct intent or project context, but it is not
repository evidence. Do not introduce architecture, implementation plans, or unsupported facts.
Preserve the supplied paths and user context in context. Write prose in outputLanguage and return the
complete corrected report as JSON only.`,
} as const;
