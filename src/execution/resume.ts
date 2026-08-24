import { join } from "node:path";
import { sha256 } from "./context";
import type { ExecutionJournal } from "./schemas";

export async function validateResume(root: string, journal: ExecutionJournal): Promise<void> {
  for (const task of journal.tasks.filter((item) => item.status === "completed")) {
    for (const output of task.output_hashes) {
      const file = Bun.file(join(root, output.path));
      if (!(await file.exists()) || sha256(await file.text()) !== output.sha256) {
        throw new Error(`Cannot resume: completed file changed: ${output.path}`);
      }
    }
  }
}
