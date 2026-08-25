import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Spec } from "../spec/schemas";
import { featureSlug } from "../spec/storage";
import type { TaskList } from "../tasks/schemas";
import { quickstartMarkdown } from "./markdown";

/**
 * Writes the acceptance trail beside the artifacts it is derived from.
 *
 * There is no YAML twin because nothing consumes it: quickstart exists for a person checking that
 * the feature works, and every fact in it already lives in spec.yaml and tasks.yaml.
 */
export async function writeQuickstart(root: string, spec: Spec, tasks: TaskList): Promise<string> {
  const directory = join(root, ".specs", featureSlug(spec.feature));
  await mkdir(directory, { recursive: true });
  const path = join(directory, "quickstart.md");
  await Bun.write(path, quickstartMarkdown(spec, tasks));
  return path;
}
