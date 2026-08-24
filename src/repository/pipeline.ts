import type { z } from "zod";
import type { ModelClient } from "../ai/model-client";
import type { Spec } from "../spec/schemas";
import { repositoryPrompts } from "./prompts";
import { indexRepository, readSnapshots } from "./scan";
import {
  fileSelectionSchema,
  type RepositoryDiscovery,
  repositoryDiscoverySchema,
} from "./schemas";

type ObjectGenerator = Pick<ModelClient, "generateObject">;

export async function discoverRepository(
  client: ObjectGenerator,
  spec: Spec,
  root: string,
): Promise<RepositoryDiscovery> {
  const index = await indexRepository(root);
  const context = { specification: spec, files: index };
  const selection = await stage("repository-select", () =>
    client.generateObject(repositoryPrompts.select, pretty(context), fileSelectionSchema),
  );
  const snapshots = await readSnapshots(root, index, selection.files);
  if (snapshots.length === 0) throw new Error("Repository discovery selected no readable files");

  const evidenceContext = {
    specification: spec,
    outputLanguage: "the language used by the specification",
    snapshots,
  };
  const candidate = await stage("repository-discover", () =>
    client.generateObject(
      repositoryPrompts.discover,
      pretty(evidenceContext),
      repositoryDiscoverySchema,
    ),
  );
  const reviewed = await stage("repository-review", () =>
    client.generateObject(
      repositoryPrompts.review,
      pretty({ ...evidenceContext, candidate }),
      repositoryDiscoverySchema,
    ),
  );
  return normalizeDiscovery(reviewed, snapshots);
}

function normalizeDiscovery(
  discovery: RepositoryDiscovery,
  snapshots: Array<{ path: string; content: string }>,
): RepositoryDiscovery {
  const available = new Set(snapshots.map((snapshot) => snapshot.path));
  const evidence = (paths: string[]) => [...new Set(paths)].filter((path) => available.has(path));
  const findings = <T extends { evidence: string[] }>(items: T[]): T[] =>
    items
      .map((item) => ({ ...item, evidence: evidence(item.evidence) }))
      .filter((item) => item.evidence.length > 0);

  return {
    ...discovery,
    technologies: findings(discovery.technologies),
    structure: findings(discovery.structure),
    relevant_files: discovery.relevant_files
      .filter((item) => available.has(item.path))
      .map((item) => ({
        ...item,
        symbols: item.symbols.filter((symbol) =>
          snapshots.find((snapshot) => snapshot.path === item.path)?.content.includes(symbol),
        ),
      })),
    conventions: findings(discovery.conventions),
    testing: findings(discovery.testing),
    constraints: findings(discovery.constraints),
  };
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`Failed ${name}`, { cause: error });
  }
}

export async function runRepositoryStage(
  client: ObjectGenerator,
  stage: string,
  input: string,
): Promise<unknown> {
  const definitions = {
    "repository-select": [repositoryPrompts.select, fileSelectionSchema],
    "repository-discover": [repositoryPrompts.discover, repositoryDiscoverySchema],
    "repository-review": [repositoryPrompts.review, repositoryDiscoverySchema],
  } as const;
  const definition = definitions[stage as keyof typeof definitions];
  if (!definition) return undefined;
  return client.generateObject(definition[0], input, definition[1] as z.ZodType<unknown>);
}
