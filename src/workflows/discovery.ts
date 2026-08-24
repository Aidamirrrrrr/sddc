import type { ModelClient } from "../ai/model-client";
import { discoverySummary } from "../cli/presentation";
import { info, required, reviewDocument, success, withSpinner } from "../cli/ui";
import { loadInputPrice } from "../config/env";
import { createRepositoryContextSelector } from "../repository/context-selector";
import {
  discoverRepository,
  discoverRepositoryFromContext,
  reviseRepositoryDiscovery,
} from "../repository/pipeline";
import type { RequestRepositoryContext } from "../repository/request-context";
import type { RepositoryDiscovery } from "../repository/schemas";
import type { Spec } from "../spec/schemas";
import { writeRepositoryDiscovery } from "../spec/storage";

export async function createApprovedDiscovery(
  client: ModelClient,
  spec: Spec,
  root: string,
  requestContext?: RequestRepositoryContext,
): Promise<RepositoryDiscovery> {
  if (!requestContext) {
    info({
      en: "Choose the repository context for discovery",
      ru: "Выберите контекст репозитория для исследования",
    });
  }
  let discovery = requestContext
    ? await withSpinner(
        { en: "Checking how the change fits the project", ru: "Проверяю устройство проекта" },
        { en: "Project understanding is ready", ru: "Устройство проекта изучено" },
        () => discoverRepositoryFromContext(client, spec, requestContext),
      )
    : await discoverRepository(
        client,
        spec,
        root,
        createRepositoryContextSelector(root, { inputUsdPerMillion: loadInputPrice() }),
      );
  success({ en: "Repository discovery is ready", ru: "Исследование репозитория готово" });
  while (true) {
    const rendered = Bun.YAML.stringify(discovery, null, 2).trimEnd();
    if (
      (await reviewDocument(
        { en: "Is this project understanding correct?", ru: "Верно ли понято устройство проекта?" },
        { en: "Project understanding", ru: "Понимание проекта" },
        discoverySummary(discovery),
        rendered,
      )) === "accept"
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
