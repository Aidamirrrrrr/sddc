import type { ModelClient } from "../ai/model-client";
import type { ContextSelector, RepositoryContext } from "./pipeline";
import { repositoryPrompts } from "./prompts";
import { type FileSnapshot, indexRepository, readSnapshots } from "./scan";
import { type FileSelection, fileSelectionSchema } from "./schemas";

type ObjectGenerator = Pick<ModelClient, "generateObject">;
export type RequestContextStage = "select" | "expand";
type StageRunner = <T>(stage: RequestContextStage, operation: () => Promise<T>) => Promise<T>;

export type RequestRepositoryContext = RepositoryContext & { snapshots: FileSnapshot[] };

const MAX_INITIAL_FILES = 12;
const MAX_EXPANSION_FILES = 6;

export async function prepareRequestRepositoryContext(
  client: ObjectGenerator,
  request: string,
  root: string,
  selectContext: ContextSelector,
  runStage: StageRunner = async (_stage, operation) => operation(),
): Promise<RequestRepositoryContext> {
  const index = await indexRepository(root);
  const selection = await runStage("select", () =>
    client.generateObject(
      repositoryPrompts.requestSelect,
      pretty({ request, files: index }),
      fileSelectionSchema,
    ),
  );
  const initial = await selectContext(
    { ...selection, files: selection.files.slice(0, MAX_INITIAL_FILES) },
    index,
  );
  const initialSnapshots = await readSnapshots(root, index, initial.files);
  if (initialSnapshots.length === 0) throw new Error("Request context selected no readable files");

  const expansion = await runStage("expand", () =>
    client.generateObject(
      repositoryPrompts.requestExpand,
      pretty({ request, files: index, currentSnapshots: initialSnapshots }),
      fileSelectionSchema,
    ),
  );
  const combined: FileSelection = {
    rationale: expansion.rationale,
    files: uniqueSelections([
      ...initial.files.map((path) => ({ path, reason: "Already approved" })),
      ...expansion.files.slice(0, MAX_EXPANSION_FILES),
    ]).slice(0, 24),
  };
  if (sameFiles(combined.files, initial.files)) {
    return { ...initial, snapshots: initialSnapshots };
  }
  const approved = await selectContext(combined, index, {
    files: combined.files.map((file) => file.path),
    userContext: initial.userContext,
  });
  const snapshots = await readSnapshots(root, index, approved.files);
  if (snapshots.length === 0) throw new Error("Request context has no readable files");
  return { ...approved, snapshots };
}

function sameFiles(left: FileSelection["files"], right: string[]): boolean {
  const paths = new Set(left.map((file) => file.path));
  return paths.size === right.length && right.every((path) => paths.has(path));
}

function uniqueSelections(files: FileSelection["files"]): FileSelection["files"] {
  return [...new Map(files.map((file) => [file.path, file])).values()];
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
