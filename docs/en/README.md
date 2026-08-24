# Codekeeper Documentation

Codekeeper builds a specification from the original request and the user's
answers. It acts as a requirements quality gate: it detects missing decisions,
contradictions, and oversized requests without inventing answers.

## Pipeline

1. Extract only explicit facts and detect the request language.
2. A unified analysis decides whether the request is ready, needs questions, or
   needs decomposition.
3. A separate reviewer checks that analysis against the source facts. The
   pipeline ends after this third call for clarification and decomposition.
4. A ready request is turned into a specification.
5. The specification passes a final checklist review.

An incomplete or oversized request therefore uses three regular LLM calls; a
ready specification uses five. Invalid analysis gets one additional repair
call.

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

After a `ready` specification is accepted, the agent runs read-only discovery:

1. Index safe project files without reading their contents.
2. Let the model recommend no more than 24 relevant files and explain each choice.
3. Let the user search, enable, or disable files and add optional project context.
4. Read only the confirmed text files within bounded size limits.
5. Let the model request up to eight additional files, then confirm the expanded
   selection with the user.
6. Describe the stack, structure, relevant files, conventions, tests,
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

After discovery is accepted, planning runs as narrow stages:

1. Draft a focused task dependency graph from `spec.yaml` and `discovery.yaml`.
2. Audit requirement and acceptance-criterion coverage without rewriting it.
3. Produce a strictly reviewed plan using ten quality checks.
4. Independently filter questions already answered by repository context or
   concerning reversible local details.
5. Repair once only when deterministic validation rejects the reviewed result.

Every task declares requirement and acceptance IDs, dependencies, files to read,
modify, or create, verification commands, completion conditions, and risks.
Commands are stored as program/argument arrays rather than shell strings, and
their file arguments must exist or be created earlier in the task graph.
Small reversible implementation decisions are listed explicitly with file
evidence instead of being hidden or turned into unnecessary user questions.
The host validates complete coverage, known IDs, an acyclic graph, safe paths,
and that existing files belong to approved discovery context.

Missing product or architecture decisions become questions. Ready plans are
shown for repeated acceptance or revision and saved as
`.specs/<feature>/plan.yaml` only after explicit approval. Planning never writes
implementation code.

## Policy And Decisions

Planning is constrained by a deterministic policy, not by model judgment alone.
The built-in policy limits each task to six changed files and three new files,
forbids sensitive paths, permits only a small command allowlist, and disables
external network access. Dependency files, configuration, and migrations require
the corresponding explicit task permission. Two tasks may write the same file
only when their dependency order is unambiguous.

A project may override these limits in `.codekeeper/policy.yaml`:

```yaml
version: 1
changes:
  max_files_per_task: 4
  max_generated_file_bytes: 131072
  require_dependency_permission: true
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
curl -fsSL https://raw.githubusercontent.com/Aidamirrrrrr/codekeeper/master/install.sh | sh
codekeeper --init
codekeeper "Describe the task"
```

For multiline input:

```bash
codekeeper < task.txt
```

The accepted specification is written to `.specs/<feature>/spec.yaml` in the
current working project.

## Configuration

`codekeeper --init` creates `~/.config/codekeeper/.env` with private file
permissions. Fill in these values before the first model run:

```env
AI_API_TOKEN=your-token
AI_API_URL=https://chat.immers.cloud/v1/endpoints/model/generate/
AI_MODEL=model-id
AI_INPUT_USD_PER_MILLION=optional-input-price
```

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
`planning-draft`, `planning-audit`, `planning-review`, `planning-questions`, and
`planning-repair`, plus `execution-implement` and `execution-review`.

Except for `extract`, stages expect the JSON context produced for that pipeline
step. This lets one model call be tested without rerunning the entire pipeline.
Thinking is disabled by default.

See [Writing Requests](writing-requests.md) for request guidance.
