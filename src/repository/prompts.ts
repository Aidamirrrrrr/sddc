export const repositoryPrompts = {
  select: `Select repository files that are most useful for understanding how an accepted product
specification fits the existing codebase. The input contains the specification and a path/size index.
Select only paths present in the index. Prefer manifests, configuration, entry points, architecture
boundaries, directly related modules, tests, and local documentation. Avoid redundant files. Select
at most 24 files and do not design a solution. Return JSON only.`,

  discover: `Produce a read-only repository discovery report for an accepted product specification.
Use only the supplied file snapshots. Every claim about technology, structure, conventions, tests,
or constraints must cite one or more supplied paths in evidence. relevant_files.path must be a
supplied path. Symbols must appear in that file; omit uncertain symbols. Do not propose architecture,
implementation steps, files to create, or product behavior. Record missing knowledge in unknowns
instead of guessing. Write prose in outputLanguage. Return JSON only.`,

  review: `Act as a strict evidence reviewer for a repository discovery report.
Correct the candidate using only the supplied file snapshots. Remove unsupported technologies,
symbols, conventions, assumptions, recommendations, and implementation plans. Every evidence path
and relevant file path must exist in the supplied snapshots. Preserve uncertainty in unknowns.
Write prose in outputLanguage and return the corrected report as JSON only.`,
} as const;
