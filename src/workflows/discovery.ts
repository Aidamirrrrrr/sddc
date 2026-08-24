import type { ModelClient } from "../ai/model-client";
import { discoverySummary, projectMapDocument } from "../cli/presentation";
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
        { en: "Mapping related code and constraints", ru: "Составляю карту связанного кода" },
        { en: "Project map is ready", ru: "Карта проекта готова" },
        () => discoverRepositoryFromContext(client, spec, requestContext),
      )
    : await discoverRepository(
        client,
        spec,
        root,
        createRepositoryContextSelector(root, { inputUsdPerMillion: loadInputPrice() }),
      );
  success({ en: "Project map is ready", ru: "Карта проекта готова" });
  while (true) {
    if (
      (await reviewDocument(
        { en: "Is this project map correct?", ru: "Карта проекта составлена верно?" },
        { en: "Project map", ru: "Карта проекта" },
        discoverySummary(discovery),
        projectMapDocument(discovery),
      )) === "accept"
    ) {
      const path = await writeRepositoryDiscovery(spec.feature, discovery);
      success({ en: `Project map saved to ${path}`, ru: `Карта проекта сохранена: ${path}` });
      return discovery;
    }
    const feedback = await required({
      en: "What should be changed in the project map?",
      ru: "Что нужно изменить в карте проекта?",
    });
    discovery = await withSpinner(
      { en: "Revising the project map", ru: "Исправляю карту проекта" },
      { en: "Project map revised", ru: "Карта проекта исправлена" },
      () => reviseRepositoryDiscovery(client, spec, discovery, feedback, root),
    );
  }
}
