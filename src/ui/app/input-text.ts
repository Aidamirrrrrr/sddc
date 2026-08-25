/**
 * The text arithmetic behind the prompt line.
 *
 * Kept apart from the component because this is where the fiddly cases live — where a token starts,
 * what a trailing backslash means, which half of a line a completion replaces — and none of them
 * need a terminal to be wrong in.
 */

/** The word the cursor is sitting at the end of: everything back to the last space or newline. */
export function currentToken(value: string): string {
  return value.split(/[\s]/).at(-1) ?? "";
}

/**
 * The file query being typed, if any.
 *
 * `@` is only a mention at the start of a word. In the middle of one it is an email address, a
 * decorator, a handle — text the person meant literally.
 */
export function mentionQuery(value: string): string | undefined {
  const token = currentToken(value);
  return token.startsWith("@") ? token.slice(1) : undefined;
}

/** Replaces the word being typed, leaving everything before it untouched. */
export function replaceToken(value: string, replacement: string): string {
  const token = currentToken(value);
  return `${value.slice(0, value.length - token.length)}${replacement}`;
}

/**
 * Whether enter should add a line rather than send.
 *
 * A trailing backslash is the continuation people already know from shells, and unlike shift+enter
 * it survives every terminal: the key combinations that would be nicer are the ones terminals
 * disagree about most.
 */
export function continuesLine(value: string): boolean {
  return /(^|[^\\])\\$/.test(value);
}

/** Turns the trailing backslash into the newline it was standing in for. */
export function breakLine(value: string): string {
  return `${value.slice(0, -1)}\n`;
}

/** Paths whose name or directory contains the query, nearest match first. */
export function matchPaths(paths: string[], query: string, limit = 8): string[] {
  const needle = query.toLowerCase();
  if (!needle) return paths.slice(0, limit);
  const scored = paths
    .filter((path) => path.toLowerCase().includes(needle))
    .map((path) => {
      const name = path.split("/").at(-1)?.toLowerCase() ?? "";
      // A file actually called what was typed beats one that merely lives somewhere similar.
      const rank = name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : 2;
      return { path, rank };
    })
    .sort((left, right) => left.rank - right.rank || left.path.length - right.path.length);
  return scored.slice(0, limit).map((item) => item.path);
}

/**
 * What a chunk of typed or pasted input should do.
 *
 * A paste arrives as one chunk, so a newline inside it never raises the return key and has to be
 * read out of the text. Multi-line paste is something somebody meant to keep whole — splitting it
 * into a submission per line was how a pasted paragraph became six truncated requests — so only a
 * newline at the very end means send.
 */
export type InputAction = { kind: "insert"; text: string } | { kind: "submit"; text: string };

export function pasteAction(chunk: string): InputAction {
  const lines = chunk.split(/\r\n|\r|\n/);
  if (lines.length === 1) return { kind: "insert", text: chunk };
  const trailing = lines.at(-1) === "";
  const text = (trailing ? lines.slice(0, -1) : lines).join("\n");
  return trailing ? { kind: "submit", text } : { kind: "insert", text };
}
