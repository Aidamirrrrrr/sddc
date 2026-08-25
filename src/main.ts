#!/usr/bin/env bun

import { runCli } from "./app/run";
import { presentError } from "./cli/errors";
import { teardownUi } from "./cli/ui";

try {
  await runCli(Bun.argv.slice(2));
  teardownUi();
} catch (error) {
  // Hand the terminal back before writing, or the live frame overwrites the error.
  teardownUi();
  const { message, hint } = presentError(error);
  const json = Bun.argv.includes("--json");
  console.error(
    json
      ? JSON.stringify({ type: "error", message, ...(hint ? { hint } : {}) })
      : `Error: ${message}${hint ? `\nNext: ${hint}` : ""}`,
  );
  if ((Bun.env.SDDC_DEBUG === "1" || Bun.argv.includes("--debug")) && error instanceof Error)
    console.error(error.stack);
  process.exitCode = 1;
}
