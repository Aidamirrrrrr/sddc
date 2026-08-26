import type { ToolCall } from "./tools";

/**
 * Tool calls for tests, so a fake model can be a script rather than a switch statement.
 *
 * Every field of a call is required and all but one are null, which is what keeps the schema
 * friendly to strict structured output — and unbearable to write out by hand thirty times.
 */
const blank: ToolCall = {
  reasoning: "",
  tool: "finish",
  read: null,
  search: null,
  write: null,
  run: null,
  finish: null,
  block: null,
};

export function toolCall(partial: Partial<ToolCall>): ToolCall {
  return { ...blank, ...partial };
}

export function writeCall(path: string, content: string): ToolCall {
  return toolCall({ tool: "write", write: { path, content } });
}

export function readCall(reason: string, paths: string[]): ToolCall {
  return toolCall({ tool: "read", read: { reason, paths } });
}

export function runCall(program: string, args: string[]): ToolCall {
  return toolCall({ tool: "run", run: { program, args } });
}

export function finishCall(
  summary: string,
  traceability: Array<{ covers: string; paths: string[] }>,
): ToolCall {
  return toolCall({ tool: "finish", finish: { summary, traceability } });
}

export function blockCall(
  reason: string,
  requiredFiles: string[],
  requiredDecision: string | null = null,
): ToolCall {
  return toolCall({
    tool: "block",
    block: { reason, required_files: requiredFiles, required_decision: requiredDecision },
  });
}

/**
 * The commonest script there is: write these files, then finish tracing everything to them.
 *
 * What a single-shot proposal used to be in one object, which is why so many tests want exactly it.
 */
export function writeAndFinish(
  files: Array<{ path: string; content: string }>,
  covers: string[],
  summary = "Change files",
): ToolCall[] {
  return [
    ...files.map((file) => writeCall(file.path, file.content)),
    finishCall(
      summary,
      covers.map((id) => ({ covers: id, paths: files.map((file) => file.path) })),
    ),
  ];
}
