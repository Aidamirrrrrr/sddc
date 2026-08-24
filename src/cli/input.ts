import { createInterface } from "node:readline/promises";

export async function readInput(arguments_: string[], label: string): Promise<string> {
  let input: string;
  if (arguments_.length > 0) input = arguments_.join(" ");
  else if (process.stdin.isTTY) input = await ask(label);
  else input = await Bun.stdin.text();
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
