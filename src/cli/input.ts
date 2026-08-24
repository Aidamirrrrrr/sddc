import { createInterface } from "node:readline/promises";
import { cancel, isCancel, text } from "@clack/prompts";

export async function readInput(arguments_: string[], label: string): Promise<string> {
  let input: string;
  if (arguments_.length > 0) input = arguments_.join(" ");
  else if (process.stdin.isTTY) {
    const value = await text({
      message: label.replace(/:\s*$/, ""),
      validate: (answer) => (answer?.trim() ? undefined : "Input cannot be empty"),
    });
    if (isCancel(value)) {
      cancel("Cancelled");
      process.exit(0);
    }
    input = value;
  } else input = await Bun.stdin.text();
  input = input.trim();
  if (!input) throw new Error("Input cannot be empty");
  return input;
}

export async function ask(label: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await terminal.question(label);
  terminal.close();
  return answer.trim();
}
