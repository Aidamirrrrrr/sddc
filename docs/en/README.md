# sddc Documentation

sddc builds a specification from the original request and the user's
answers. It acts as a requirements quality gate: it detects missing decisions,
contradictions, and oversized requests without inventing answers.

## What You Approve

- **Requirements** describe the expected change and acceptance criteria.
- **Project map** records related existing code, tests, and constraints.
- **Technical plan** fixes the approach, the changed contracts, and the data model.
- **Task graph** lists concrete file changes, dependency waves, and verification commands.

These are not four versions of the same document. Each stage adds only the
detail unavailable to the previous one. The terminal renders human-readable
text; YAML remains in `.specs` for resuming and deterministic validation.

Before specification, an intent gate separates change requests from read-only
repository questions. Ambiguous requests are returned to the user for clarification.

## Repository Questions

For an explanation, inspection, or review request, sddc does not create a
specification. It proposes relevant files, lets the user control the context,
reads only the approved snapshots, and produces a reviewed answer with file
evidence and explicit unknowns. This path cannot plan or execute source changes.

## Pipeline

1. Classify the request as a project change, read-only inquiry, or ambiguous intent.
2. For a change, propose repository files and let the user approve context before specification.
3. Extract explicit request facts and detect the request language.
4. A unified analysis decides whether the request is ready, needs questions, or
   needs decomposition.
5. A separate reviewer checks that analysis against request facts and approved code context. The
   pipeline ends after this third call for clarification and decomposition.
6. A ready request is turned into a specification.
7. The specification passes a final checklist review.

Repository facts such as existing signatures, usages, tests, and module wiring
are resolved from approved snapshots. Only missing product or irreversible
architecture decisions are returned to the user as questions.

Context selection and expansion use two LLM calls before specification. An
incomplete or oversized specification then uses three calls; a ready one uses
five. Invalid analysis gets one additional repair call.

If a stage returns empty or schema-invalid structured output, the client sends
the original context and validation error back to the model for one retry. It
never retries indefinitely.

In an interactive terminal, `needs_clarification` starts another question
round. Answers are appended to the original request and the complete pipeline
runs again. The loop ends only with `ready` or `needs_decomposition`. Empty
answers are rejected; use `Ctrl+C` to stop.

A ready specification or decomposition is printed in full and requires an
explicit `accept` or `revise` decision. On revision, the rejected YAML and the
user's requested changes are appended to the context before rebuilding. Only
an accepted version is written as `spec.yaml`.

Piped input cannot continue a conversation or provide approval, so the agent
prints the result and writes it as `spec.draft.yaml`.

## Repository Discovery

After a `ready` specification is accepted, the agent turns the already approved
context into a read-only discovery:

1. Index safe project files without reading their contents.
2. Let the model recommend no more than 12 relevant files and explain each choice.
3. Let the user search, enable, or disable files and add optional project context.
4. Read only the confirmed text files within bounded size limits.
5. Let the model request up to six additional files. Ask for a second approval
   only when the selection actually changes.
6. After specification approval, describe the stack, structure, relevant files, conventions, tests,
   constraints, and unknowns.
7. Use a second call to remove findings without file evidence.
8. Show the discovery for explicit acceptance or repeated revision before saving.

`.env`, private keys, `.git`, `.specs`, dependencies, and build output are never
sent to the model. Discovery neither designs nor modifies anything. Its result
is written to `.specs/<feature>/discovery.yaml`.

The selector shows the model's reason next to recommended files, supports
type-to-search, and blocks selections over 24 files or 200 KiB. Additional
context is treated as a user statement and never as repository evidence.
The confirmed paths and user context are recorded in `discovery.yaml`.
Its workspace groups file labels as recommended, tests, configuration, or
project files. It also previews selected files, estimates input tokens and cost,
and saves reusable project profiles under `.specs/context-profiles/`.

Discovery does not run for accepted decomposition: a concrete subfeature must
be selected and specified first.

## Implementation Planning

After discovery is accepted, planning decides *how* the change is built — and
nothing else. It runs as narrow stages:

1. Draft the technical approach, changed contracts, and data model from
   `spec.yaml` and `discovery.yaml`.
2. Audit requirement coverage of the approach without rewriting it.
3. Produce a strictly reviewed plan using six quality checks.
4. Independently filter questions already answered by repository context or
   concerning reversible local details.
5. Repair once only when deterministic validation rejects the reviewed result.

The plan contains no tasks. Every approach step cites the requirement IDs it
serves, and the host verifies that the approach leaves no requirement uncovered
and that every decision cites approved evidence. An accepted plan is written to
`.specs/<feature>/plan.yaml`.

## Task Graph

A separate phase derives the executable task graph from the accepted plan. It
mirrors the planning stages — draft, audit, review against ten checks, question
filter, one repair — and never revisits the plan's decisions.

Independent tasks are grouped into **dependency waves**. The wave is computed
from the graph by the host, never claimed by the model: tasks in the same wave
share no dependency and, because the policy forbids unordered writes to one
file, no write conflict either. Tasks in a shared wave are marked `[P]` in the
terminal, and the model is instructed not to invent dependencies that would
serialize independent work.

Every task declares requirement and acceptance IDs, dependencies, files to read,
modify, or create, verification commands, completion conditions, and risks.
Commands are stored as program/argument arrays rather than shell strings, and
their file arguments must exist or be created earlier in the task graph.
Small reversible implementation decisions are listed explicitly with file
evidence instead of being hidden or turned into unnecessary user questions.
The host validates complete coverage, known IDs, an acyclic graph, safe paths,
and that existing files belong to approved discovery context.

Missing product or architecture decisions become questions. A ready task graph
is shown for repeated acceptance or revision and saved as
`.specs/<feature>/tasks.yaml` only after explicit approval. Neither phase writes
implementation code.

## Recompiling A Feature

Stored artifacts are inputs, not history. Edit `spec.yaml` and rebuild
everything below it instead of hand-patching the plan:

```bash
sddc --recompile plan -- registration     # rebuild plan, tasks, then implement
sddc --recompile tasks -- registration    # keep the plan, rebuild the tasks
sddc --recompile execute -- registration  # implement the stored task graph
```

The feature name may be omitted when `.specs` holds exactly one feature.

## Interface

In an interactive terminal the agent runs as an application: a persistent phase
rail across the top carrying each phase's state, the live region of the current
stage below it, and a status line at the bottom. Finished documents, answers and
events scroll into the terminal's own scrollback, so history stays selectable with
the mouse and survives the session.

All output goes through a single driver (`src/ui/`), which keeps the modes
consistent:

- interactive TTY — the Ink application;
- `--plain` — stable lines;
- `--json` — one event per line;
- non-TTY or `--no-input` — line output that never prompts.

No pipeline stage writes to stdout directly, so the interface can change without
touching a workflow.

## Cost and prefix caching

Within a phase every stage appends its predecessor's output to the same context
object, so everything before that appendix repeats verbatim. To let a provider use
that, requests are composed **context first, instruction last**: the system message
is constant across stages and the stage instruction trails the user message. Had
the instruction stayed in the system message, the prefix would diverge at token
zero and nothing would ever be cached.

This pays off on providers with automatic prefix caching (OpenAI, DeepSeek, most
vLLM deployments). Providers that require explicit cache breakpoints cannot express
them through an OpenAI-compatible API.

A run ends with a summary: model calls, input and output tokens, and the share of
input the provider served from cache. The share appears only when the provider
reports it, and it is what tells you whether caching is actually working.

## Parallel waves

Tasks in a wave are independent by construction, and model latency dominates a run.
So proposals for the siblings of the current task are generated concurrently while
it waits for review. Writing, verifying and approving stay strictly ordered — the
terminal must never host two conversations at once.

Not every task in a wave is prefetched. Policy forbids two tasks writing the same
file without ordering, but **reading another task's write is not forbidden**. A task
that reads a file a wave sibling modifies or creates is prepared in the normal
order, because generating it early would build its proposal from content that is
about to change.

`strict` mode never prefetches at all. It exists so the user authorizes each task
before any work happens on it, and spending a model call ahead of that approval
would defeat the mode.

## Language

The interface language is chosen at startup. To stop being asked every run, set
`SDDC_LANG=ru` or `SDDC_LANG=en` in `~/.config/sddc/.env` and the question is
skipped. The `--lang` flag overrides both.

**Artifact** language is decided separately, and differently: not by a setting but
by the document's own content. The model writes prose in the language of the
request, so each artifact infers its language from its own text. Russian
requirements never end up under English headings, and one project can hold
features in different languages without a shared setting.

Headings, field labels and status values are translated; identifiers, paths and
commands are left alone.

## Working with an artifact under review

While an artifact waits for a decision, five actions are available:

- **Accept** — continue to the next phase;
- **View full document** — expand the summary;
- **Edit directly** — open the YAML in `$EDITOR` and change it by hand;
- **Ask for a revision** — describe what is wrong and rebuild;
- **Decisions so far** — show everything already answered in this phase.

Editing directly removes the model from a decision it was never needed for:
describing in prose a change you could simply write is a lossy round trip. Edited
YAML is validated against the schema; if it does not parse, the edit is rejected
and the previous artifact stands. Task waves are re-derived rather than taken from
the file — they are computed, never authored.

Editing and inspecting decisions do not spend a revision round, because neither
changes anything upstream.

Going back to an earlier phase happens between runs, with `--recompile`.

## Artifact format

Every artifact is written twice. YAML is the machine format — it is what the
pipeline parses and validates. The Markdown beside it (`spec.md`, `plan.md`,
`tasks.md`, `discovery.md`) exists for review: an artifact is the thing a person
is asked to approve, and a YAML diff is a poor place to do that.

The Markdown is one-way: nothing reads it back, so it can never disagree with the
YAML about what was accepted.

`quickstart.md` is written alongside them: the acceptance trail, listing every
criterion, the tasks covering it and the commands that prove it. It has no YAML
twin because nothing parses it — every fact is derived from `spec.yaml` and
`tasks.yaml`, and asking a model for it would only add a way to disagree with them.

## Instability and sampling

`temperature: 0` does not make a served model deterministic: the same input yields a
different task graph from one run to the next. Wording cannot fix that — the spread
comes from inference, not from the prompt.

So the goal is not a stable graph but a narrow one: constrain the set of acceptable
graphs until **any** sample that passes is executable. The spread then stops being a
problem and becomes a resource — the wider it is, the likelier some sample passes.

The task phase draws up to `sampling.max_attempts` candidates (3 by default) and
takes the first that satisfies the validators. The first draw runs the full
draft/audit/review chain; later ones repair against the rejection, which is cheaper
and better informed than starting over.

The verifier here is free and deterministic, so an extra draw costs one model call
and buys a real chance of a valid artifact. It is also the rejection-sampling
mechanism a distilled model would need for training.

## Acceptance ownership

An acceptance criterion belongs to **exactly one** task. A requirement may be served
by several.

The reason is simple: a criterion is a test, and a test has one home. If a criterion
is split across four tasks then none of them implements it, and the per-task check
"all claimed criteria are implemented" becomes impossible to satisfy. Splitting also
destroys credit assignment: a failing criterion no longer names a task.

Coverage becomes a **partition** rather than a cover, which is exactly what makes it
checkable by code.

A task that serves a requirement without completing a criterion leaves `acceptance`
empty, which is legitimate. Under test-first the criterion belongs to the task that
writes the test verifying it, and the implementation serves requirements.

## Test before implementation

SDD Article III — no implementation before its test — is marked non-negotiable.
Here it is expressed as policy rather than as a request in a prompt:

```yaml
changes:
  require_test_before_implementation: true
```

With the rule on, a task that changes **behavioural** source must depend on a
separate earlier task that writes the test. Writing the test in the same task does
not count: "before" would then mean nothing, and the ordering is exactly what the
article is about.

Configuration, documentation and lockfiles need no test behind them — they carry no
behaviour to assert, and demanding one would only teach people to switch the rule
off.

A task that writes **only** tests must leave verification red. A test that passes
before its implementation exists asserts nothing, so a green result is the failure for
such a task. The expectation is derived from the task's file list rather than declared
by the model — it cannot be faked, any more than a wave can.

The rule is checked on the graph, before anything runs, and is **off** by default.
Turning it on before the eval corpus shows models reliably produce conforming
graphs would fail every run.

## Evaluating quality

Editing a prompt or trimming context changes what the model produces, and without
a measurement that is a blind bet. An eval corpus makes the change measurable.

Nothing has to be hand-labelled: a stored feature already holds artifacts a user
reviewed and approved. Recording a case is a copy.

```bash
sddc --eval-record -- registration   # record an accepted run as a case
sddc --eval                          # score the corpus, no model calls
sddc --eval --live                   # regenerate plan and tasks, then score
```

Scoring reuses the pipeline's own validators instead of inventing a rubric: they
already encode what correct means here, they cannot be argued with, and they run
without a model. Cases are checked for `spec-valid`, `plan-valid`, `tasks-valid`
and `tasks-policy`; coverage gaps are counted separately — not failures, but the
number should not grow.

Offline, the corpus replays recorded artifacts, which catches a validator change
that silently starts rejecting work a user already accepted. With `--live`, plan
and tasks are rebuilt from the recorded specification, which is what makes a
prompt or context change verifiable.

The command exits non-zero when a case fails, so it can gate CI or a pre-commit
hook.

## Consistency analysis

Stored artifacts are meant to be edited, so the agent records which version of its
input each derived artifact came from (`provenance.yaml`). One command reports the
drift without changing anything:

```bash
sddc --analyze -- registration
```

It reports two kinds of problem. **stale** means an artifact was derived from an
input version that no longer exists on disk — `spec.yaml` was edited while
`plan.yaml` still answers the previous requirements. **gap** means a requirement or
acceptance criterion that no plan step or task claims to serve. The per-phase
validators cannot see either one, because each of them only ever looks at a single
phase.

## Dialogue and limits

Answers to clarifying questions are written to `.specs/session.yaml` as soon as they
are typed. When a stage fails, rerunning the same request continues from the answers
already given instead of restarting the conversation. A session is keyed by the
request text, so answers are never replayed into a different request. Once the task
graph is stored the session is cleared, because every answer now lives in an artifact.

Round counts are bounded by policy so the model cannot loop the dialogue:

```yaml
dialogue:
  max_clarification_rounds: 3
  max_revision_rounds: 5
```

## Policy And Decisions

Planning is constrained by a deterministic policy, not by model judgment alone.
The built-in policy limits each task to six changed files and three new files,
forbids sensitive paths, permits only a small command allowlist, and disables
external network access. Dependency files, configuration, and migrations require
the corresponding explicit task permission. Two tasks may write the same file
only when their dependency order is unambiguous.

Principles the policy cannot express — architectural rules, testing doctrine,
house style — belong in `.sddc/constitution.md`. It is passed to the planning
and task phases as prose and is never parsed: the policy blocks, the
constitution only informs. A conflict between a principle and the specification
must be recorded as a disclosed decision rather than silently resolved.

A project may override these limits in `.sddc/policy.yaml`:

```yaml
version: 1
changes:
  max_files_per_task: 4
  max_generated_file_bytes: 131072
  require_dependency_permission: true
  require_test_before_implementation: false
execution:
  default_approval_mode: normal
  max_changed_lines_per_task: 400
  max_proposal_revisions: 1
  command_timeout_seconds: 120
  allow_git_checkpoints: false
commands:
  allowed_programs: [bun, node]
  allow_external_network: false
```

The override is validated and merged with defaults. A malformed policy stops the
run. Once the user accepts a plan, its declared permissions are considered
accepted for that plan only. The effective policy is saved to
`.specs/<feature>/policy.yaml` so the result remains reproducible.

The agent also writes `.specs/<feature>/decisions.yaml`. It records product
requirements, user-supplied repository context, reversible implementation
decisions, and granted permissions with their owner and source. This makes it
possible to distinguish a user decision from repository evidence or an agent
inference. No source files or commands are executed at this stage.

## Controlled Execution

After planning, a contract summary shows tasks, files, permissions, commands, and
network policy. Implementation starts only with separate confirmation. Tasks run
in dependency order. For each task, the model receives its approved scope and
current snapshots and either returns complete file contents or an explicit
blocker requiring replanning. The host checks paths, operations, changed-line and
content-size limits, requirement traces, and SHA-256 snapshots.

A separate read-only model call checks coverage, scope, public behavior, secrets,
error handling, test quality, and undeclared decisions. It may reject but cannot
edit a proposal. Revision attempts are limited by policy.

- `strict` confirms task scope, selected diff files, and every command;
- `normal` confirms each task diff;
- `trusted` automatically accepts ordinary task diffs.

Sensitive permissions and network commands require immediate confirmation in
every mode. Removing a file from strict scope blocks execution and requires plan
revision instead of silently producing a partial implementation.

Accepted changes are written atomically and the plan's verification commands run
directly without a shell. Only a small environment allowlist is inherited. A
failed command restores every file changed by that task before asking whether to
try another proposal. Progress and bounded command output are stored in
`.specs/<feature>/execution.yaml`.

After verification, the user can continue, roll the task back for another
proposal, or create an explicitly enabled Git checkpoint. Resume is allowed only
while completed file hashes match. Final acceptance shows the overall Git diff
and verification summary and can return an uncheckpointed task from the current
session for another revision.

This is application-level containment, not an operating-system sandbox. An
approved project command can still execute arbitrary project code, so the user
must inspect both the plan and diff before accepting them.

## Statuses

- `ready` — requirements and acceptance criteria are complete;
- `needs_clarification` — a product decision is still required;
- `needs_decomposition` — the request contains independently deliverable
  capabilities.

## Usage

```bash
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/sddc/master/install.sh | sh
sddc --init
sddc "Describe the task"
```

Use `sddc --dry-run "Describe the task"` to stop after the accepted plan
without changing source files. `--plain` and `--json` provide stable output,
`--no-input` prevents prompts, and `--debug` includes stack traces in errors.

For multiline input:

```bash
sddc < task.txt
```

The accepted specification is written to `.specs/<feature>/spec.yaml` in the
current working project.

## Configuration

`sddc --init` creates `~/.config/sddc/.env` with private file
permissions. Fill in these values before the first model run:

```env
AI_API_TOKEN=your-token
AI_API_URL=https://chat.immers.cloud/v1/endpoints/model/generate/
AI_MODEL=model-id
AI_INPUT_USD_PER_MILLION=optional-input-price
AI_MAX_OUTPUT_TOKENS=optional-output-cap-or-off
AI_REQUEST_TIMEOUT_SECONDS=optional-seconds
SDDC_LANG=en
SDDC_THEME=dark
```

`budget.max_model_calls` in `.sddc/policy.yaml` is the whole run's ceiling on model calls
(default 400), and `--max-calls <n>` overrides it for one invocation. Every other limit in the
pipeline bounds one loop, and those loops nest — task attempts around loop turns around proposal
draws around schema repairs — so they multiply rather than add. This is the only place that
arithmetic is visible. A small feature measures at roughly thirty calls end to end, so the ceiling
should never fire on work that is going well.

`AI_MAX_OUTPUT_TOKENS` caps a single model **completion** (default 32768,
minimum 1024). It is not the context window: the window limits the input and is
never set here, while a model's maximum output is an order of magnitude smaller
than it. On reasoning models the thinking tokens are billed against this same
budget, so a value that is too small yields an empty response on heavy stages
such as `tasks-audit`. When a response does come back empty, the agent retries
once with reasoning degraded so the whole budget goes to the answer.

`AI_REQUEST_TIMEOUT_SECONDS` bounds how long one request may stay open (default 300, minimum
10). A connection that opens and then goes quiet is indistinguishable from a slow model, so without
a bound an unattended run waits on it forever. A timed-out request is retried; one you cancelled is
not.

Set `AI_MAX_OUTPUT_TOKENS=off` to send no cap at all and leave the model's own
maximum in force. That is the right setting when the endpoint is a flat-rate or
self-hosted one; against a per-token endpoint the default is a deliberate bound
on an otherwise open-ended bill.

`SDDC_LANG` and `SDDC_THEME` are preferences rather than credentials, and both are written back
the first time they are answered: the language selector appears once, and `/lang` or `/theme` in the
session records the new choice in the same file. `SDDC_THEME` takes `dark`, `light`, or `ansi`;
left empty, the palette is read from the terminal — `NO_COLOR` or a missing `COLORTERM` selects
`ansi`, and `COLORFGBG` decides between light and dark.

Process environment variables take precedence over the user configuration.
To install a development build from this repository, run
`bun install && bun run install:local`.

Token counts are estimates because tokenization depends on the model. Cost is
shown only when `AI_INPUT_USD_PER_MILLION` is configured.

The same client supports Ollama's OpenAI-compatible API:

```env
AI_API_TOKEN=ollama
AI_API_URL=http://127.0.0.1:11434/v1/
AI_MODEL=your-local-model
```

## Stage Diagnostics

```bash
bun start --stage extract --thinking off -- "Describe the task"
bun start --stage analyze --thinking on -- context.json
```

Available stages are `extract`, `analyze`, `analysis-review`, `analysis-repair`,
`write`, `review`, `repository-select`, `repository-expand`,
`repository-discover`, `repository-review`, `repository-revise`,
`planning-draft`, `planning-audit`, `planning-review`, `planning-questions`,
`planning-repair`, `tasks-draft`, `tasks-audit`, `tasks-review`,
`tasks-questions`, and `tasks-repair`, plus `execution-implement` and
`execution-review`.

Except for `extract`, stages expect the JSON context produced for that pipeline
step. This lets one model call be tested without rerunning the entire pipeline.
Thinking is disabled by default.

See [Writing Requests](writing-requests.md) for request guidance.
