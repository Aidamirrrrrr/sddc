import type { ModelClient } from "../ai/model-client";
import { formatSpec } from "../cli/approval";
import { askRequired, askReviewDecision } from "../cli/review";
import { buildSpec } from "../spec/pipeline";
import type { Spec } from "../spec/schemas";
import { writeSpec } from "../spec/storage";

export async function createApprovedSpecification(
  client: ModelClient,
  initialRequest: string,
): Promise<Spec | null> {
  let request = initialRequest;
  while (true) {
    console.log("Building specification...");
    const spec = await buildSpec(client, request);
    if (!process.stdin.isTTY) {
      console.log(`\n${formatSpec(spec)}\n`);
      console.log(`Draft specification written to ${await writeSpec(spec, false)}`);
      return null;
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
    if ((await askReviewDecision("Accept specification? [a]ccept/[r]evise: ")) === "accept") {
      console.log(`Specification written to ${await writeSpec(spec)}`);
      return spec;
    }
    const feedback = await askRequired("What should be changed? ");
    request += `\n\nRejected specification:\n${rendered}\n\nUser review feedback:\n${feedback}\n`;
  }
}
