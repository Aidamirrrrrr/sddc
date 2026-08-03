# rust-coding-agent

A minimal CLI coding agent, written from scratch in Rust — a Claude Code-style REPL that can read, write, and edit files, list directories, and run shell commands on your behalf, with conversation memory and a tool-calling loop against an OpenAI-compatible chat completions API.

Built as a learning project to go from zero Rust syntax to a working, self-refactoring agent.

## Features

- **REPL** with persistent conversation history across turns
- **Tool calling loop** — the model can chain multiple tool calls before answering
- **Six tools**:
  - `read_file` — read a file's contents
  - `write_file` — create or overwrite a file
  - `edit_file` — replace one exact string occurrence in a file (requires a unique match, or `replace_all: true`)
  - `multi_edit_file` — apply several string replacements to one file atomically
  - `list_dir` — list files/directories
  - `run_command` — run a shell command and capture stdout/stderr
- **Confirmation prompts** before any destructive action (`write_file`, `edit_file`, `multi_edit_file`, `run_command`)
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
[выполняю: read_file {"path":"Cargo.toml"}]
...

> exit
```

## Safety notes

- `write_file`, `edit_file`, `multi_edit_file`, and `run_command` all require typing `y` to confirm before anything touches disk or spawns a process.
- `run_command` executes via `sh -c`, so it can run anything the current user can — treat it accordingly.
- There is no sandboxing; this is a learning project, not a hardened tool.
