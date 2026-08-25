import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Resolves the feature to act on, letting the common single-feature project skip naming it. */
export async function resolveFeature(root: string, requested: string): Promise<string> {
  if (requested) return requested;
  const entries = await readdir(join(root, ".specs"), { withFileTypes: true }).catch(() => []);
  const features = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (features.length === 1 && features[0]) return features[0];
  throw new Error(
    features.length === 0
      ? "No stored feature found in .specs"
      : `Name the feature: ${features.join(", ")}`,
  );
}
