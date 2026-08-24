# rust-coding-agent

A minimal CLI coding agent, written from scratch in Rust — a Claude Code-style REPL that can inspect and modify a project and run shell commands on your behalf, with conversation memory and a tool-calling loop against an OpenAI-compatible chat completions API.

Built as a learning project to go from zero Rust syntax to a working, self-refactoring agent.

## Features

- **REPL** with persistent conversation history across turns
- **Tool calling loop** — the model can chain multiple tool calls before answering
- **Three tools**:
  - `inspect` — read files (including line ranges), list directories, and search text recursively
  - `modify` — write, replace, patch, or delete files
  - `execute` — run shell commands with an optional working directory and capture the exit code, stdout, and stderr
- **Confirmation prompts** before any modifying action or command execution
- **Runaway-loop guard** — caps tool-calling rounds per user turn (`MAX_TOOL_ROUNDS`)
- **System prompt** describing the agent's role and working directory

## Project layout

```
src/
  main.rs   REPL loop, system prompt, entry point
  api.rs    HTTP client + response structs for the chat completions API
  tools.rs  tool implementations, tool_definitions() JSON schema, shared helpers
```

## Setup

Requires Rust (via [rustup](https://rustup.rs)) and an API token for an OpenAI-compatible chat completions endpoint.

```bash
cp .env.example .env
# edit .env and set AI_API_TOKEN
```

## Usage

```bash
cargo run
```

```
> прочитай Cargo.toml и скажи какие там зависимости
[выполняю: inspect {"operation":"read","path":"Cargo.toml"}]
...

> exit
```

## Safety notes

- Every `modify` operation and `execute` call requires typing `y` to confirm before anything touches disk or spawns a process.
- `execute` runs commands via `sh -c`, so it can run anything the current user can — treat it accordingly.
- There is no sandboxing; this is a learning project, not a hardened tool.
