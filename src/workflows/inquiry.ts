import type { ModelClient } from "../ai/model-client";
import { loadInputPrice } from "../config/env";
import { answerRepositoryInquiry } from "../inquiry/pipeline";
import { createRepositoryContextSelector } from "../repository/context-selector";

export async function runRepositoryInquiry(
  client: ModelClient,
  request: string,
  language: string,
  root: string,
): Promise<void> {
  console.log("Inspecting repository...");
  const answer = await answerRepositoryInquiry(
    client,
    request,
    language,
    root,
    createRepositoryContextSelector(root, { inputUsdPerMillion: loadInputPrice() }),
  );
  console.log(`\n${answer.answer}\n`);
  console.log("Evidence:");
  for (const item of answer.evidence) console.log(`- ${item.path}: ${item.finding}`);
  if (answer.unknowns.length > 0) {
    console.log("\nUnknowns:");
    for (const unknown of answer.unknowns) console.log(`- ${unknown}`);
  }
}
