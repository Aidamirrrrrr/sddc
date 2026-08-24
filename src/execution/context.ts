import { join } from "node:path";
import type { ImplementationPlan } from "../planning/schemas";

export type ExecutionFile = { path: string; sha256: string; content: string };

export async function readTaskFiles(
  root: string,
  task: ImplementationPlan["tasks"][number],
): Promise<ExecutionFile[]> {
  const paths = [...new Set([...task.files.read, ...task.files.modify])];
  return Promise.all(
    paths.map(async (path) => {
      const file = Bun.file(join(root, path));
      if (!(await file.exists())) throw new Error(`Task ${task.id} requires missing file: ${path}`);
      const content = await file.text();
      return { path, content, sha256: sha256(content) };
    }),
  );
}

export function sha256(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}
