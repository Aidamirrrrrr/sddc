import type { z } from "zod";
import type { ModelClient } from "../ai/model-client";
import type { Spec } from "../spec/schemas";
import { repositoryPrompts } from "./prompts";
import { indexRepository, readSnapshots } from "./scan";
import {
  type FileSelection,
  fileSelectionSchema,
  type RepositoryDiscovery,
  repositoryDiscoverySchema,
} from "./schemas";

type ObjectGenerator = Pick<ModelClient, "generateObject">;
export type RepositoryContext = { files: string[]; userContext: string };
export type ContextSelector = (
  selection: FileSelection,
  index: Awaited<ReturnType<typeof indexRepository>>,
  current?: RepositoryContext,
) => Promise<RepositoryContext>;

export async function discoverRepository(
  client: ObjectGenerator,
  spec: Spec,
  root: string,
  selectContext?: ContextSelector,
): Promise<RepositoryDiscovery> {
  const index = await indexRepository(root);
  const context = { specification: spec, files: index };
  const selection = await stage("repository-select", () =>
    client.generateObject(repositoryPrompts.select, pretty(context), fileSelectionSchema),
  );
  const contextSelection = selectContext
    ? await selectContext(selection, index)
    : { files: selection.files.map((file) => file.path), userContext: "" };
  const initialSnapshots = await readSnapshots(root, index, contextSelection.files);
  if (initialSnapshots.length === 0)
    throw new Error("Repository discovery selected no readable files");

  const expansion = await stage("repository-expand", () =>
    client.generateObject(
      repositoryPrompts.expand,
      pretty({
        specification: spec,
        files: index,
        currentSnapshots: initialSnapshots,
        userContext: contextSelection.userContext || undefined,
      }),
      fileSelectionSchema,
    ),
  );
  const expandedSelection: FileSelection = {
    files: uniqueSelections([
      ...contextSelection.files.map((path) => ({ path, reason: "Already approved" })),
      ...expansion.files,
    ]).slice(0, 24),
    rationale: expansion.rationale,
  };
  const finalContext = selectContext
    ? await selectContext(expandedSelection, index, {
        files: expandedSelection.files.map((file) => file.path),
        userContext: contextSelection.userContext,
      })
    : {
        files: expandedSelection.files.map((file) => file.path),
        userContext: contextSelection.userContext,
      };
  const snapshots = await readSnapshots(root, index, finalContext.files);
  if (snapshots.length === 0) throw new Error("Repository discovery selected no readable files");

  const evidenceContext = {
    specification: spec,
    outputLanguage: "the language used by the specification",
    userContext: finalContext.userContext || undefined,
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
  return normalizeDiscovery(reviewed, snapshots, finalContext.userContext);
}

export async function reviseRepositoryDiscovery(
  client: ObjectGenerator,
  spec: Spec,
  discovery: RepositoryDiscovery,
  feedback: string,
  root: string,
): Promise<RepositoryDiscovery> {
  const index = await indexRepository(root);
  const snapshots = await readSnapshots(root, index, discovery.context.files);
  if (snapshots.length === 0) throw new Error("Repository discovery has no readable context files");
  const revised = await stage("repository-revise", () =>
    client.generateObject(
      repositoryPrompts.revise,
      pretty({
        specification: spec,
        outputLanguage: "the language used by the specification",
        userFeedback: feedback,
        snapshots,
        candidate: discovery,
      }),
      repositoryDiscoverySchema,
    ),
  );
  return normalizeDiscovery(revised, snapshots, discovery.context.user_context);
}

function normalizeDiscovery(
  discovery: RepositoryDiscovery,
  snapshots: Array<{ path: string; content: string }>,
  userContext: string,
): RepositoryDiscovery {
  const available = new Set(snapshots.map((snapshot) => snapshot.path));
  const evidence = (paths: string[]) => [...new Set(paths)].filter((path) => available.has(path));
  const findings = <T extends { evidence: string[] }>(items: T[]): T[] =>
    items
      .map((item) => ({ ...item, evidence: evidence(item.evidence) }))
      .filter((item) => item.evidence.length > 0);

  return {
    ...discovery,
    context: { files: snapshots.map((snapshot) => snapshot.path), user_context: userContext },
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

function uniqueSelections(files: FileSelection["files"]): FileSelection["files"] {
  return [...new Map(files.map((file) => [file.path, file])).values()];
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
    "repository-expand": [repositoryPrompts.expand, fileSelectionSchema],
    "repository-discover": [repositoryPrompts.discover, repositoryDiscoverySchema],
    "repository-review": [repositoryPrompts.review, repositoryDiscoverySchema],
    "repository-revise": [repositoryPrompts.revise, repositoryDiscoverySchema],
  } as const;
  const definition = definitions[stage as keyof typeof definitions];
  if (!definition) return undefined;
  return client.generateObject(definition[0], input, definition[1] as z.ZodType<unknown>);
}
