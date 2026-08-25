import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSuspendedUi } from "../ui/driver";

/**
 * Opens content in the user's editor and returns what came back.
 *
 * Describing a change in prose and asking the model to reproduce it is a lossy round trip for
 * something the user can simply write. Editing the artifact directly removes the model from a
 * decision it was never needed for.
 */
export async function editText(content: string, extension = "yaml"): Promise<string> {
  const editor = (process.env.VISUAL || process.env.EDITOR || "").trim();
  if (!editor) {
    throw new Error("No editor configured. Set $EDITOR or $VISUAL to edit an artifact in place.");
  }
  const directory = await mkdtemp(join(tmpdir(), "sddc-edit-"));
  const path = join(directory, `artifact.${extension}`);
  await writeFile(path, content, "utf8");

  // The editor needs the terminal the application surface is holding.
  const status = await withSuspendedUi(async () => {
    const [program = editor, ...args] = editor.split(/\s+/);
    const process_ = Bun.spawn([program, ...args, path], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return process_.exited;
  });
  if (status !== 0)
    throw new Error(`Editor exited with status ${status}; the artifact is unchanged`);

  return readFile(path, "utf8");
}
