export const taskPrompts = {
  draft: `Derive an executable task graph from an accepted implementation plan. The plan already fixed
the technical approach, contracts, and data model; do not revisit those decisions and do not write code
or patches. Each task implements part of the accepted approach, has one focused goal, cites requirement
and acceptance IDs from the specification, and lists explicit read/modify/create paths, dependencies,
verification commands, completion conditions, and concrete risks. Existing read and modify paths must
come from discovery.context.files. New paths may appear only in create. Declare a dependency only when
a task truly needs the output of another one: independent tasks are executed as one parallel wave, so
every unnecessary dependency makes the graph slower. Two tasks that write the same file must be
ordered by a dependency. Use only commands supported by repository evidence, represented as a program
and an argument array, never as a shell string. Every file argument must already exist or be created
by that task or a dependency. Follow the supplied policy, and the constitution principles when one is supplied. Declare
permissions only when a task genuinely needs them; a permission is visible to the user and is not a way to bypass a forbidden
policy. Ask at most three neutral questions, and only when the plan left a user-owned decision
genuinely open. Write all prose in outputLanguage and return JSON only.`,

  audit: `Audit a task graph without rewriting it. Check every specification requirement and acceptance
criterion for task coverage. Look for tasks that are too broad, unapproved existing files, invalid
commands, missing dependencies, dependency cycles, unsafe write ordering, dependencies that are not
actually needed, and tasks that go beyond the accepted plan. Prefer needs_clarification only for
genuinely blocking user-owned decisions. Use IDs from the supplied artifacts, write prose in
outputLanguage, and return JSON only.`,

  review: `Produce the final task graph after reviewing the draft and audit. Do not write code. Resolve
mechanical problems, split broad tasks, drop dependencies that are not required so independent work
can run in the same wave, and preserve full traceability to the specification and the accepted plan.
Existing read/modify paths must be approved discovery context files; only create paths may be new.
Return needs_clarification when blocking user-owned information is missing. Also return exactly these
checks, each passed only when true:
C1 all requirements covered; C2 all acceptance criteria covered; C3 tasks are focused; C4 dependencies
are complete and acyclic; C5 existing paths are approved; C6 create paths are explicit; C7 verification
commands are evidence-backed; C8 every task follows the accepted plan; C9 write ordering is safe;
C10 completion criteria are testable. Write all prose in outputLanguage and return JSON only.`,

  questions: `Review only the blocking questions in a task graph. Remove questions that are answered by
the specification, the accepted plan, the repository index, snapshots, or discovery. Remove questions
about small reversible implementation details that should be decided from project evidence. Keep only
decisions owned by the user: missing product behavior, public contracts, security policy, external
integrations, migrations, or costly and irreversible architecture. Classify the owner, whether context
already answers it, affected requirement/acceptance IDs, and whether alternatives change user-visible
behavior. Questions about code structure, APIs internal to the repository, imports, libraries already
in use, file placement, testing mechanics, or reversible implementation choices always have owner
implementation. Write every question in outputLanguage and return JSON only.`,

  repair: `Repair a rejected task graph using the validation error. Do not write code, do not change the
accepted plan, and do not add unsupported decisions. Preserve traceability to the accepted
specification and use only approved existing repository files. Use supplied snapshots for local
implementation details. If the error cannot be resolved without a user-owned decision, return
needs_clarification with a neutral question. Write all prose in outputLanguage and return JSON only.`,
} as const;
