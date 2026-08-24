import type { ModelClient } from "../ai/model-client";
import { askRequired, askReviewDecision } from "../cli/review";
import { loadInputPrice } from "../config/env";
import { createRepositoryContextSelector } from "../repository/context-selector";
import { discoverRepository, reviseRepositoryDiscovery } from "../repository/pipeline";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import { writeRepositoryDiscovery } from "../spec/storage";

export async function createApprovedDiscovery(
  client: ModelClient,
  spec: Spec,
  root: string,
): Promise<RepositoryDiscovery> {
  console.log("Discovering repository...");
  let discovery = await discoverRepository(
    client,
    spec,
    root,
    createRepositoryContextSelector(root, { inputUsdPerMillion: loadInputPrice() }),
  );
  while (true) {
    console.log(`\n${Bun.YAML.stringify(discovery, null, 2).trimEnd()}\n`);
    if (
      (await askReviewDecision("Accept repository discovery? [a]ccept/[r]evise: ")) === "accept"
    ) {
      console.log(
        `Repository discovery written to ${await writeRepositoryDiscovery(spec.feature, discovery)}`,
      );
      return discovery;
    }
    const feedback = await askRequired("What should be changed in discovery? ");
    console.log("Revising repository discovery...");
    discovery = await reviseRepositoryDiscovery(client, spec, discovery, feedback, root);
  }
}
