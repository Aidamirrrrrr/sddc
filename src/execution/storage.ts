import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type ExecutionJournal, executionJournalSchema } from "./schemas";

export async function writeExecutionJournal(
  root: string,
  journal: ExecutionJournal,
): Promise<string> {
  const value = executionJournalSchema.parse(journal);
  const directory = join(root, ".specs", journal.feature);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "execution.yaml");
  await Bun.write(path, Bun.YAML.stringify(value, null, 2));
  return path;
}

export async function loadExecutionJournal(
  root: string,
  feature: string,
): Promise<ExecutionJournal | null> {
  const path = join(root, ".specs", feature, "execution.yaml");
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return executionJournalSchema.parse(Bun.YAML.parse(await file.text()));
  } catch (error) {
    throw new Error(`Failed to load execution journal "${path}"`, { cause: error });
  }
}
