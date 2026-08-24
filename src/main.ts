#!/usr/bin/env bun

import { ModelClient } from "./ai/model-client";
import { formatSpec, parseReviewDecision, type ReviewDecision } from "./cli/approval";
import { parseCli } from "./cli/args";
import { ask, readInput } from "./cli/input";
import { loadInputPrice, loadModelConfig } from "./config/env";
import { buildDecisionRegistry } from "./decisions/build";
import { writeGovernanceArtifacts } from "./decisions/storage";
import {
  buildImplementationPlan,
  preparePlanningContext,
  runPlanningStage,
} from "./planning/pipeline";
import type { ImplementationPlan } from "./planning/schemas";
import { writeImplementationPlan } from "./planning/storage";
import { loadPolicy } from "./policy/load";
import type { Policy } from "./policy/schemas";
import { createRepositoryContextSelector } from "./repository/context-selector";
import {
  discoverRepository,
  reviseRepositoryDiscovery,
  runRepositoryStage,
} from "./repository/pipeline";
import { buildSpec, runStage } from "./spec/pipeline";
import type { Spec } from "./spec/schemas";
import { writeRepositoryDiscovery, writeSpec } from "./spec/storage";

async function main(): Promise<void> {
  const cli = parseCli(Bun.argv.slice(2));
  const client = new ModelClient(loadModelConfig(), cli.thinking);

  if (cli.stage) {
    const input = await readInput(cli.input, "Stage input: ");
    const result = cli.stage.startsWith("repository-")
      ? await runRepositoryStage(client, cli.stage, input)
      : cli.stage.startsWith("planning-")
        ? await runPlanningStage(client, cli.stage, input)
        : await runStage(client, cli.stage, input);
    if (result === undefined) throw new Error(`Unknown stage "${cli.stage}"`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let request = await readInput(cli.input, "Describe the task: ");
  let spec: Spec;

  while (true) {
    console.log("Building specification...");
    spec = await buildSpec(client, request);
    if (!process.stdin.isTTY) {
      console.log(`\n${formatSpec(spec)}\n`);
      console.log(`Draft specification written to ${await writeSpec(spec, false)}`);
      return;
    }
    if (spec.status === "needs_clarification") {
      request += "\n\nUser clarifications:\n";
      for (const question of spec.questions) {
        console.log(`- ${question.question}`);
        console.log(`  ${question.reason}`);
        request += `${question.id}: ${await askRequired("> ")}\n`;
      }
      continue;
    }

    const rendered = formatSpec(spec);
    console.log(`\n${rendered}\n`);
    if ((await askReviewDecision()) === "accept") {
      break;
    }
    const feedback = await askRequired("What should be changed? ");
    request += `\n\nRejected specification:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }

  console.log(`Specification written to ${await writeSpec(spec)}`);
  if (spec.status === "ready") {
    console.log("Discovering repository...");
    let discovery = await discoverRepository(
      client,
      spec,
      process.cwd(),
      createRepositoryContextSelector(process.cwd(), {
        inputUsdPerMillion: loadInputPrice(),
      }),
    );
    while (true) {
      console.log(`\n${Bun.YAML.stringify(discovery, null, 2).trimEnd()}\n`);
      if ((await askDiscoveryReviewDecision()) === "accept") break;
      const feedback = await askRequired("What should be changed in discovery? ");
      console.log("Revising repository discovery...");
      discovery = await reviseRepositoryDiscovery(client, spec, discovery, feedback, process.cwd());
    }
    console.log(
      `Repository discovery written to ${await writeRepositoryDiscovery(spec.feature, discovery)}`,
    );
    const policy = await loadPolicy(process.cwd());
    const plan = await createApprovedPlan(client, spec, discovery, policy);
    console.log(`Implementation plan written to ${await writeImplementationPlan(plan)}`);
    const governance = await writeGovernanceArtifacts(
      process.cwd(),
      spec.feature,
      buildDecisionRegistry(spec, discovery, plan),
      policy,
    );
    console.log(`Decision registry written to ${governance.decisions}`);
    console.log(`Effective policy written to ${governance.policy}`);
  }
}

async function createApprovedPlan(
  client: ModelClient,
  spec: Spec,
  discovery: Parameters<typeof buildImplementationPlan>[2],
  policy: Policy,
): Promise<ImplementationPlan> {
  let userInput = "";
  const repository = await preparePlanningContext(process.cwd(), discovery);
  while (true) {
    console.log("Building implementation plan...");
    const plan = await buildImplementationPlan(
      client,
      spec,
      discovery,
      userInput,
      repository,
      policy,
    );
    if (plan.status === "needs_clarification") {
      userInput += "\n\nUser planning clarifications:\n";
      for (const question of plan.questions) {
        console.log(`- ${question.question}`);
        console.log(`  ${question.reason}`);
        userInput += `${question.id}: ${await askRequired("> ")}\n`;
      }
      continue;
    }

    const rendered = Bun.YAML.stringify(plan, null, 2).trimEnd();
    console.log(`\n${rendered}\n`);
    if ((await askPlanReviewDecision()) === "accept") return plan;
    const feedback = await askRequired("What should be changed in the plan? ");
    userInput += `\n\nRejected implementation plan:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}

async function askDiscoveryReviewDecision(): Promise<ReviewDecision> {
  while (true) {
    const decision = parseReviewDecision(
      await ask("Accept repository discovery? [a]ccept/[r]evise: "),
    );
    if (decision !== null) return decision;
    console.log("Enter 'a' to accept or 'r' to revise.");
  }
}

async function askPlanReviewDecision(): Promise<ReviewDecision> {
  while (true) {
    const decision = parseReviewDecision(
      await ask("Accept implementation plan? [a]ccept/[r]evise: "),
    );
    if (decision !== null) return decision;
    console.log("Enter 'a' to accept or 'r' to revise.");
  }
}

async function askReviewDecision(): Promise<ReviewDecision> {
  while (true) {
    const decision = parseReviewDecision(await ask("Accept specification? [a]ccept/[r]evise: "));
    if (decision !== null) return decision;
    console.log("Enter 'a' to accept or 'r' to revise.");
  }
}

async function askRequired(label: string): Promise<string> {
  while (true) {
    const answer = await ask(label);
    if (answer.length > 0) return answer;
    console.log("An answer is required to complete the specification.");
  }
}

await main();
