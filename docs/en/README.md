# Spec Agent Documentation

Spec Agent builds a specification from the original request and the user's
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

## Statuses

- `ready` — requirements and acceptance criteria are complete;
- `needs_clarification` — a product decision is still required;
- `needs_decomposition` — the request contains independently deliverable
  capabilities.

## Usage

```bash
bun install
bun start -- "Describe the task"
```

For multiline input:

```bash
bun start < task.txt
```

The accepted specification is written to `.specs/<feature>/spec.yaml` in the
current working project.

## Configuration

```env
AI_API_TOKEN=your-token
AI_API_URL=https://chat.immers.cloud/v1/endpoints/model/generate/
AI_MODEL=model-id
AI_INPUT_USD_PER_MILLION=optional-input-price
```

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
`planning-repair`.

Except for `extract`, stages expect the JSON context produced for that pipeline
step. This lets one model call be tested without rerunning the entire pipeline.
Thinking is disabled by default.

See [Writing Requests](writing-requests.md) for request guidance.
