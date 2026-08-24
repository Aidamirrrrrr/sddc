import type { ModelClient } from "../ai/model-client";
import type { RepositoryContext } from "../repository/pipeline";
import { indexRepository, readSnapshots } from "../repository/scan";
import { type FileSelection, fileSelectionSchema } from "../repository/schemas";
import { inquiryPrompts } from "./prompts";
import { type InquiryAnswer, inquiryAnswerSchema } from "./schemas";

type ObjectGenerator = Pick<ModelClient, "generateObject">;
export type InquiryStage = "select" | "expand" | "answer" | "review";
type StageRunner = <T>(stage: InquiryStage, operation: () => Promise<T>) => Promise<T>;
type ContextSelector = (
  selection: FileSelection,
  index: Awaited<ReturnType<typeof indexRepository>>,
  current?: RepositoryContext,
) => Promise<RepositoryContext>;

export async function answerRepositoryInquiry(
  client: ObjectGenerator,
  request: string,
  language: string,
  root: string,
  selectContext: ContextSelector,
  runStage: StageRunner = async (_stage, operation) => operation(),
): Promise<InquiryAnswer> {
  const index = await indexRepository(root);
  const selected = await runStage("select", () =>
    client.generateObject(
      inquiryPrompts.select,
      pretty({ question: request, files: index }),
      fileSelectionSchema,
    ),
  );
  const initialContext = await selectContext(selected, index);
  const initialSnapshots = await readSnapshots(root, index, initialContext.files);
  if (initialSnapshots.length === 0)
    throw new Error("Repository inquiry selected no readable files");

  const expansion = await runStage("expand", () =>
    client.generateObject(
      inquiryPrompts.expand,
      pretty({ question: request, files: index, currentSnapshots: initialSnapshots }),
      fileSelectionSchema,
    ),
  );
  const combined: FileSelection = {
    rationale: expansion.rationale,
    files: uniqueSelections([
      ...initialContext.files.map((path) => ({ path, reason: "Already approved" })),
      ...expansion.files,
    ]).slice(0, 24),
  };
  const finalContext = await selectContext(combined, index, {
    files: combined.files.map((file) => file.path),
    userContext: initialContext.userContext,
  });
  const snapshots = await readSnapshots(root, index, finalContext.files);
  if (snapshots.length === 0) throw new Error("Repository inquiry has no readable context files");

  const context = {
    question: request,
    outputLanguage: language,
    userContext: finalContext.userContext || undefined,
    snapshots,
  };
  const candidate = await runStage("answer", () =>
    client.generateObject(inquiryPrompts.answer, pretty(context), inquiryAnswerSchema),
  );
  const reviewed = await runStage("review", () =>
    client.generateObject(
      inquiryPrompts.review,
      pretty({ ...context, candidate }),
      inquiryAnswerSchema,
    ),
  );
  return normalizeAnswer(reviewed, new Set(snapshots.map((snapshot) => snapshot.path)));
}

function normalizeAnswer(answer: InquiryAnswer, available: Set<string>): InquiryAnswer {
  const evidence = answer.evidence.filter((item) => available.has(item.path));
  if (evidence.length === 0) throw new Error("Repository inquiry answer has no valid evidence");
  return { ...answer, evidence };
}

function uniqueSelections(files: FileSelection["files"]): FileSelection["files"] {
  return [...new Map(files.map((file) => [file.path, file])).values()];
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
