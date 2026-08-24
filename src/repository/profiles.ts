import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const profileSchema = z.object({
  name: z.string(),
  files: z.array(z.string()),
  user_context: z.string(),
});

export type ContextProfile = z.infer<typeof profileSchema>;

export async function listContextProfiles(root: string): Promise<ContextProfile[]> {
  const directory = profileDirectory(root);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const profiles: ContextProfile[] = [];
  for (const name of names.filter((value) => value.endsWith(".yaml")).sort()) {
    const path = join(directory, name);
    try {
      profiles.push(profileSchema.parse(Bun.YAML.parse(await Bun.file(path).text())));
    } catch (error) {
      throw new Error(`Failed to load context profile "${path}"`, { cause: error });
    }
  }
  return profiles;
}

export async function writeContextProfile(root: string, profile: ContextProfile): Promise<string> {
  const directory = profileDirectory(root);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${profileSlug(profile.name)}.yaml`);
  await Bun.write(path, Bun.YAML.stringify(profileSchema.parse(profile), null, 2));
  return path;
}

function profileDirectory(root: string): string {
  return join(root, ".specs", "context-profiles");
}

function profileSlug(value: string): string {
  const slug = value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Profile name must contain letters or digits");
  return slug;
}
