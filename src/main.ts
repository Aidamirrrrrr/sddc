#!/usr/bin/env bun

import { runCli } from "./app/run";
import { presentError } from "./cli/errors";

try {
  await runCli(Bun.argv.slice(2));
} catch (error) {
  const { message, hint } = presentError(error);
  const json = Bun.argv.includes("--json");
  console.error(
    json
      ? JSON.stringify({ type: "error", message, ...(hint ? { hint } : {}) })
      : `Error: ${message}${hint ? `\nNext: ${hint}` : ""}`,
  );
  if ((Bun.env.CODEKEEPER_DEBUG === "1" || Bun.argv.includes("--debug")) && error instanceof Error)
    console.error(error.stack);
  process.exitCode = 1;
}
