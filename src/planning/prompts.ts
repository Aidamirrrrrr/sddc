export const planningPrompts = {
  draft: `Create a small, executable implementation task graph from an accepted specification and
evidence-backed repository discovery. This is planning only: do not write code or patches. Every task
must have one focused goal, cite requirement and acceptance IDs, list explicit read/modify/create
paths, dependencies, verification commands, completion conditions, and concrete risks. Existing read
and modify paths must come from discovery.context.files. New paths may appear only in create. Use only
commands supported by repository evidence. Represent commands as a program and argument array, never
as a shell string. Every file argument must already exist or be created by that task or a dependency.
Follow the supplied policy. Declare permissions only when a task genuinely needs them; a permission is
visible to the user and is not a way to bypass a forbidden policy.
Make small, reversible implementation decisions when they
follow supplied snapshots and record them in decisions with file evidence. Do not ask the user about
details answerable from snapshots or local conventions. Ask at most three neutral questions only for
missing product behavior, public contracts, security policy, data migration, external systems, or
costly and irreversible architecture. Write all prose in outputLanguage and return JSON only.`,

  audit: `Audit an implementation plan without rewriting it. Check every specification requirement and
acceptance criterion for task coverage. Look for tasks that are too broad, unsupported architecture,
unapproved existing files, invalid commands, missing dependencies, dependency cycles, unsafe ordering,
and decisions not grounded in the specification or repository snapshots. Local reversible decisions
are valid when explicit and evidence-backed. Prefer needs_clarification only for genuinely blocking
user-owned decisions. Use IDs from the supplied artifacts, write prose in outputLanguage, and return
JSON only.`,

  review: `Produce the final implementation plan after reviewing the draft and audit. Do not write code.
Resolve mechanical planning problems, split broad tasks, preserve full traceability, and ask the user
when product behavior, a public contract, security policy, external integration, migration behavior,
or costly architecture is not established. Make and disclose small reversible choices that follow
repository evidence. Existing read/modify paths must be approved discovery
context files; only create paths may be new. Return needs_clarification when blocking information is
missing. Also return exactly these checks, each passed only when true:
C1 all requirements covered; C2 all acceptance criteria covered; C3 tasks are focused; C4 dependencies
are complete and acyclic; C5 existing paths are approved; C6 create paths are explicit; C7 verification
commands are evidence-backed; C8 no unsupported decisions; C9 ordering is safe; C10 completion criteria
are testable. Write all prose in outputLanguage and return JSON only.`,

  questions: `Review only the blocking questions in an implementation plan. Remove questions that are
answered by the specification, repository index, snapshots, discovery, or the plan itself. Remove
questions about small reversible implementation details that should be decided from project evidence.
Keep only decisions owned by the user: missing product behavior, public contracts, security policy,
external integrations, migrations, or costly and irreversible architecture. Classify the owner,
whether context already answers it, affected requirement/acceptance IDs, and whether alternatives
change user-visible behavior. Questions about code structure, APIs internal to the repository, imports,
libraries already in use, file placement, testing mechanics, or reversible implementation choices
always have owner implementation. Write every question in outputLanguage and return JSON only.`,

  repair: `Repair a rejected implementation plan using the validation error. Do not write code or add
unsupported decisions. Preserve traceability to the accepted specification and use only approved
existing repository files. Use supplied snapshots for local implementation details. If the error
cannot be resolved without a user-owned decision, return
needs_clarification with a neutral question. Write all prose in outputLanguage and return JSON only.`,
} as const;
