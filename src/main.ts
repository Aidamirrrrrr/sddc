#!/usr/bin/env bun

import { InterruptedError } from "./ai/interrupt";
import { runCli } from "./app/run";
import { presentError } from "./cli/errors";
import { teardownUi } from "./cli/ui";

try {
  await runCli(Bun.argv.slice(2));
  teardownUi();
} catch (error) {
  // Hand the terminal back before writing, or the live frame overwrites the error.
  teardownUi();
  // Someone pressing escape asked for this. Reporting their own decision back to them as a failure,
  // with a stack trace under --debug, would be the tool arguing with the person using it.
  if (error instanceof InterruptedError) {
    console.error("Stopped. Nothing further was sent to the model.");
    process.exitCode = 130;
  } else {
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
}
