# Spec Agent Documentation

Spec Agent builds a specification from the original request and the user's
answers. It acts as a requirements quality gate: it detects missing decisions,
contradictions, and oversized requests without inventing answers.

## Pipeline

1. Extract only explicit facts and detect the request language.
2. Check whether the facts can support objective acceptance criteria.
3. Analyze ambiguity and remove implementation-oriented questions.
4. Decide whether the request is one coherent flow or needs decomposition.
5. Write the specification and run the final quality checklist.

In an interactive terminal, `needs_clarification` starts another question
round. Answers are appended to the original request and the complete pipeline
runs again. The loop ends only with `ready` or `needs_decomposition`. Empty
answers are rejected; use `Ctrl+C` to stop.

Piped input cannot continue a conversation, so the agent writes a specification
containing its unresolved questions.

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

The specification is written to `.specs/<feature>/spec.yaml` in the current
working project.

## Configuration

```env
AI_API_TOKEN=your-token
AI_API_URL=https://chat.immers.cloud/v1/endpoints/model/generate/
AI_MODEL=model-id
```

The same client supports Ollama's OpenAI-compatible API:

```env
AI_API_TOKEN=ollama
AI_API_URL=http://127.0.0.1:11434/v1/
AI_MODEL=your-local-model
```

## Stage Diagnostics

```bash
bun start --stage extract --thinking off -- "Describe the task"
bun start --stage clarification --thinking on -- context.json
```

Available stages are `extract`, `clarification`, `ambiguity`, `question-review`,
`scope`, `scope-review`, `write`, and `review`.

Except for `extract`, stages expect the JSON context produced for that pipeline
step. This lets one model call be tested without rerunning the entire pipeline.
Thinking is disabled by default.

See [Writing Requests](writing-requests.md) for request guidance.
