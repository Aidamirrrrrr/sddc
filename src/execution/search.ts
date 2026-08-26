import { join } from "node:path";
import { isForbiddenPath, isSafeProjectPath } from "../policy/paths";
import type { Policy } from "../policy/schemas";
import { indexRepository, MAX_FILE_BYTES, type RepositoryFile } from "../repository/scan";

export type SearchMatch = { path: string; line: number; text: string };

const MAX_MATCHES = 30;
const MAX_MATCHES_PER_FILE = 6;
const MAX_LINE_LENGTH = 200;

/**
 * Finding where something lives, without handing over a shell.
 *
 * A task that has to change a function it can see, against a convention it cannot, has no way to
 * ask "where else is this used" — and guessing is how a slice ends up inconsistent with the code
 * around it. This is the read-only half of that question.
 *
 * The needle is matched **literally**, case-insensitively, rather than as a regular expression.
 * Nearly every real search here is for a symbol, where a literal is exactly right; and a regex
 * supplied by a model is a regex nobody reviewed, which on a large file is an unbounded amount of
 * backtracking inside a phase whose whole discipline is that everything is bounded.
 */
export async function searchRepository(
  root: string,
  needle: string,
  glob: string,
  policy: Policy,
  index?: RepositoryFile[],
): Promise<SearchMatch[]> {
  const term = needle.trim().toLocaleLowerCase();
  if (!term) return [];
  const files = index ?? (await indexRepository(root));
  const matching = globFilter(glob);
  const matches: SearchMatch[] = [];

  for (const file of files) {
    if (matches.length >= MAX_MATCHES) break;
    if (file.size > MAX_FILE_BYTES) continue;
    if (!isSafeProjectPath(file.path)) continue;
    if (isForbiddenPath(file.path, policy.changes.forbid_paths)) continue;
    if (!matching(file.path)) continue;

    const content = await Bun.file(join(root, file.path)).text();
    if (content.includes("\0")) continue;
    let found = 0;
    const lines = content.split("\n");
    for (let index_ = 0; index_ < lines.length; index_ += 1) {
      if (found >= MAX_MATCHES_PER_FILE || matches.length >= MAX_MATCHES) break;
      const line = lines[index_];
      if (line === undefined || !line.toLocaleLowerCase().includes(term)) continue;
      found += 1;
      matches.push({ path: file.path, line: index_ + 1, text: truncate(line.trim()) });
    }
  }
  return matches;
}

/**
 * A deliberately small glob: `*` within a segment, `**` across them, and nothing else.
 *
 * Anything richer would be a second path language beside the one policy already speaks, and the
 * only thing asked of it here is to narrow a search to a directory or an extension.
 */
export function globFilter(glob: string): (path: string) => boolean {
  const pattern = glob.trim();
  if (!pattern || pattern === "*" || pattern === "**") return () => true;
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) break;
    if (character === "*") {
      // `**` crosses directory separators, `*` stays inside one segment.
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    expression += character === "?" ? "[^/]" : character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  try {
    const regex = new RegExp(`^${expression}$`, "i");
    return (path) => regex.test(path);
  } catch {
    // An unusable pattern narrows nothing rather than finding nothing, which is the kinder failure.
    return () => true;
  }
}

function truncate(line: string): string {
  return line.length <= MAX_LINE_LENGTH ? line : `${line.slice(0, MAX_LINE_LENGTH)}…`;
}
