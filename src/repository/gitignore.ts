import { join } from "node:path";

/**
 * What the project already says it does not want indexed.
 *
 * The walker carried a hardcoded exclusion list, which is right for `.git` and `node_modules` and
 * wrong for everything a particular project builds into a directory nobody else has heard of. A
 * repository with a large `vendor/` spent the whole five-thousand-file budget on files no one would
 * ever pick as context — and that index is what the user chooses from.
 *
 * The root `.gitignore` only, and a documented subset of its syntax: anchors, directory patterns,
 * `*`, `**`, `?`, and negation by later-wins. Nested ignore files and the rest of the spec are
 * deliberately absent — this decides what to *offer* a person, so being slightly too generous is a
 * far cheaper mistake than reimplementing git badly.
 */
export type IgnoreMatcher = (path: string, isDirectory: boolean) => boolean;

type Rule = { test: RegExp; negated: boolean; directoryOnly: boolean };

export async function loadGitignore(root: string): Promise<IgnoreMatcher> {
  const file = Bun.file(join(root, ".gitignore"));
  if (!(await file.exists())) return () => false;
  return compileGitignore(await file.text());
}

export function compileGitignore(source: string): IgnoreMatcher {
  const rules: Rule[] = [];
  for (const line of source.split(/\r?\n/)) {
    const rule = compileRule(line);
    if (rule) rules.push(rule);
  }
  if (rules.length === 0) return () => false;

  return (path, isDirectory) => {
    let ignored = false;
    // Later rules win, which is how a negation re-includes something an earlier pattern took.
    for (const rule of rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.test.test(path)) ignored = !rule.negated;
    }
    return ignored;
  };
}

function compileRule(line: string): Rule | undefined {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return undefined;
  const negated = pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  // A pattern with no slash matches at any depth; one with a slash is anchored to the root.
  const anchored = pattern.includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);
  if (!pattern) return undefined;

  const body = translate(pattern);
  // Matching the entry itself and everything under it, so ignoring `dist` ignores `dist/app.js`.
  const expression = anchored ? `^${body}(?:/.*)?$` : `^(?:.*/)?${body}(?:/.*)?$`;
  try {
    return { test: new RegExp(expression), negated, directoryOnly };
  } catch {
    return undefined;
  }
}

function translate(pattern: string): string {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) break;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
        // `**/` should also match nothing at all, so `**/build` catches a root-level build.
        if (pattern[index + 1] === "/") index += 1;
        continue;
      }
      expression += "[^/]*";
      continue;
    }
    expression += character === "?" ? "[^/]" : character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return expression;
}
