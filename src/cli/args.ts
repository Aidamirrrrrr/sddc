export type Cli = {
  stage?: string;
  thinking: boolean;
  help: boolean;
  init: boolean;
  version: boolean;
  input: string[];
};

export function parseCli(args: string[]): Cli {
  const cli: Cli = { thinking: false, help: false, init: false, version: false, input: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) break;
    if (value === "--help" || value === "-h") {
      cli.help = true;
    } else if (value === "--init") {
      cli.init = true;
    } else if (value === "--version" || value === "-v") {
      cli.version = true;
    } else if (value === "--stage") {
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
