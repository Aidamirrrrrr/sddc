import type { ModelClient } from "../ai/model-client";
import { document, info, required, review, success, withSpinner } from "../cli/ui";
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
  info({
    en: "Choose the repository context for discovery",
    ru: "Выберите контекст репозитория для исследования",
  });
  let discovery = await discoverRepository(
    client,
    spec,
    root,
    createRepositoryContextSelector(root, { inputUsdPerMillion: loadInputPrice() }),
  );
  success({ en: "Repository discovery is ready", ru: "Исследование репозитория готово" });
  while (true) {
    document(
      { en: "Repository discovery", ru: "Исследование репозитория" },
      Bun.YAML.stringify(discovery, null, 2).trimEnd(),
    );
    if (
      (await review({ en: "Accept this discovery?", ru: "Принять это исследование?" })) === "accept"
    ) {
      const path = await writeRepositoryDiscovery(spec.feature, discovery);
      success({ en: `Discovery saved to ${path}`, ru: `Исследование сохранено: ${path}` });
      return discovery;
    }
    const feedback = await required({
      en: "What should be changed in discovery?",
      ru: "Что нужно изменить в исследовании?",
    });
    discovery = await withSpinner(
      { en: "Revising repository discovery", ru: "Исправляю исследование репозитория" },
      { en: "Discovery revised", ru: "Исследование исправлено" },
      () => reviseRepositoryDiscovery(client, spec, discovery, feedback, root),
    );
  }
}
