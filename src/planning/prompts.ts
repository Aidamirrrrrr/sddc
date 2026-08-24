export const planningPrompts = {
  draft: `Create the technical plan for an accepted specification, using evidence-backed repository
discovery. This is planning only: do not write code, patches, or a task breakdown — tasks are derived
in a later phase. Produce the ordered technical approach, where every step states what will be built
and which requirement IDs it serves, plus the files it is expected to touch. Record the contracts the
feature introduces or changes (http endpoints, CLI surfaces, events, module APIs, storage) and the
data model entities it introduces or changes; leave both empty when the feature genuinely changes
neither. Make small, reversible implementation decisions when they follow supplied snapshots and
record them in decisions with file evidence taken from discovery.context.files. Do not ask the user
about details answerable from snapshots or local conventions. Ask at most three neutral questions only
for missing product behavior, public contracts, security policy, data migration, external systems, or
costly and irreversible architecture. Follow the supplied policy. When a constitution is supplied, follow its principles; if the
specification cannot be served without violating one, do not violate it silently — record the
conflict as a decision with its rationale. Write all prose in outputLanguage and return JSON only.`,

  audit: `Audit a technical plan without rewriting it. Check every specification requirement against the
approach steps. Look for unsupported architecture, decisions not grounded in the specification or
repository snapshots, contracts or data model entries that contradict existing code, and missing
coverage. Local reversible decisions are valid when explicit and evidence-backed. Prefer
needs_clarification only for genuinely blocking user-owned decisions. Use IDs from the supplied
artifacts, write prose in outputLanguage, and return JSON only.`,

  review: `Produce the final technical plan after reviewing the draft and audit. Do not write code and do
not break the work into tasks. Preserve full requirement coverage in the approach, and ask the user
when product behavior, a public contract, security policy, external integration, migration behavior, or
costly architecture is not established. Make and disclose small reversible choices that follow
repository evidence; decision evidence must be approved discovery context files. Return
needs_clarification when blocking information is missing. Also return exactly these checks, each passed
only when true:
C1 every requirement is served by an approach step; C2 approach steps are ordered and coherent;
C3 contracts reflect every changed public surface; C4 the data model reflects every changed entity;
C5 decisions are evidence-backed; C6 nothing in the plan contradicts repository snapshots.
Write all prose in outputLanguage and return JSON only.`,

  questions: `Review only the blocking questions in a technical plan. Remove questions that are answered
by the specification, repository index, snapshots, discovery, or the plan itself. Remove questions about
small reversible implementation details that should be decided from project evidence. Keep only
decisions owned by the user: missing product behavior, public contracts, security policy, external
integrations, migrations, or costly and irreversible architecture. Classify the owner, whether context
already answers it, affected requirement/acceptance IDs, and whether alternatives change user-visible
behavior. Questions about code structure, APIs internal to the repository, imports, libraries already
in use, file placement, testing mechanics, or reversible implementation choices always have owner
implementation. Write every question in outputLanguage and return JSON only.`,

  repair: `Repair a rejected technical plan using the validation error. Do not write code, do not break
the work into tasks, and do not add unsupported decisions. Preserve traceability to the accepted
specification and use only approved existing repository files as decision evidence. Use supplied
snapshots for local implementation details. If the error cannot be resolved without a user-owned
decision, return needs_clarification with a neutral question. Write all prose in outputLanguage and
return JSON only.`,
} as const;
