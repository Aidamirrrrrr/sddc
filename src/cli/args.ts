export type Cli = { stage?: string; thinking: boolean; input: string[] };

export function parseCli(args: string[]): Cli {
  const cli: Cli = { thinking: false, input: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) break;
    if (value === "--stage") {
      cli.stage = requireArgument(args, ++index, "--stage");
    } else if (value === "--thinking") {
      const mode = requireArgument(args, ++index, "--thinking");
      if (mode !== "on" && mode !== "off") {
        throw new Error("--thinking must be 'on' or 'off'");
      }
      cli.thinking = mode === "on";
    } else if (value === "--") {
      cli.input.push(...args.slice(index + 1));
      break;
    } else {
      cli.input.push(value);
    }
  }
  return cli;
}

function requireArgument(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}
