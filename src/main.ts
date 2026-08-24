#!/usr/bin/env bun

import { ModelClient } from "./ai/model-client";
import { parseCli } from "./cli/args";
import { ask, readInput } from "./cli/input";
import { loadModelConfig } from "./config/env";
import { buildSpec, runStage } from "./spec/pipeline";
import type { Spec } from "./spec/schemas";
import { writeSpec } from "./spec/storage";

async function main(): Promise<void> {
  const cli = parseCli(Bun.argv.slice(2));
  const client = new ModelClient(loadModelConfig(), cli.thinking);

  if (cli.stage) {
    const input = await readInput(cli.input, "Stage input: ");
    console.log(JSON.stringify(await runStage(client, cli.stage, input), null, 2));
    return;
  }

  let request = await readInput(cli.input, "Describe the task: ");
  let spec: Spec;

  while (true) {
    console.log("Building specification...");
    spec = await buildSpec(client, request);
    if (spec.status !== "needs_clarification" || !process.stdin.isTTY) {
      break;
    }

    request += "\n\nUser clarifications:\n";
    for (const question of spec.questions) {
      console.log(`- ${question.question}`);
      console.log(`  ${question.reason}`);
      request += `${question.id}: ${await askRequired("> ")}\n`;
    }
  }

  console.log(`Specification written to ${await writeSpec(spec)}`);
}

async function askRequired(label: string): Promise<string> {
  while (true) {
    const answer = await ask(label);
    if (answer.length > 0) return answer;
    console.log("An answer is required to complete the specification.");
  }
}

await main();
