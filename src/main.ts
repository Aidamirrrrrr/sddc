#!/usr/bin/env bun

import { runCli } from "./app/run";

try {
  await runCli(Bun.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  if (Bun.env.CODEKEEPER_DEBUG === "1" && error instanceof Error) console.error(error.stack);
  process.exitCode = 1;
}
