#!/usr/bin/env bun

import { runCli } from "./app/run";

try {
  await runCli(Bun.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const json = Bun.argv.includes("--json");
  const hint = errorHint(message);
  console.error(
    json
      ? JSON.stringify({ type: "error", message, ...(hint ? { hint } : {}) })
      : `Error: ${message}${hint ? `\nNext: ${hint}` : ""}`,
  );
  if ((Bun.env.CODEKEEPER_DEBUG === "1" || Bun.argv.includes("--debug")) && error instanceof Error)
    console.error(error.stack);
  process.exitCode = 1;
}

function errorHint(message: string): string | undefined {
  if (message.includes("AI_API_URL") || message.includes("AI_API_TOKEN"))
    return "Run `codekeeper --init`, then fill in ~/.config/codekeeper/.env.";
  if (message.includes("--no-input"))
    return "Pass the request after `--` or pipe it through stdin.";
  if (message.includes("context approval")) return "Start Codekeeper in an interactive terminal.";
  if (/fetch|network|timed? out|ECONN/i.test(message))
    return "Check the model endpoint and network connection, then run the same command again.";
  return undefined;
}
