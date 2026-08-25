import { createInterface } from "node:readline/promises";
import { driver } from "../ui/driver";

export async function readInput(
  arguments_: string[],
  label: string,
  options: { noInput?: boolean } = {},
): Promise<string> {
  let input: string;
  if (arguments_.length > 0) input = arguments_.join(" ");
  else if (process.stdin.isTTY && options.noInput) {
    throw new Error("Input is required with --no-input. Pass it after -- or through stdin.");
  } else if (process.stdin.isTTY) {
    input = await driver().text(label.replace(/:\s*$/, ""), {
      required: true,
      requiredMessage: "Input cannot be empty",
    });
  } else input = await Bun.stdin.text();
  input = input.trim();
  if (!input && options.noInput)
    throw new Error("Input is required with --no-input. Pass it after -- or through stdin.");
  if (!input) throw new Error("Input cannot be empty");
  return input;
}

export async function ask(label: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await terminal.question(label);
  terminal.close();
  return answer.trim();
}
