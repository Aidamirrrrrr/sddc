export type Cli = {
  stage?: string;
  recompile?: "plan" | "tasks" | "execute";
  analyze: boolean;
  evaluate: boolean;
  evalRecord: boolean;
  live: boolean;
  language?: "en" | "ru";
  thinking: boolean;
  /** Overrides the run's model-call ceiling for this invocation only. */
  maxCalls?: number;
  help: boolean;
  init: boolean;
  version: boolean;
  dryRun: boolean;
  plain: boolean;
  json: boolean;
  noInput: boolean;
  debug: boolean;
  input: string[];
};

export function parseCli(args: string[]): Cli {
  const cli: Cli = {
    analyze: false,
    evaluate: false,
    evalRecord: false,
    live: false,
    thinking: false,
    help: false,
    init: false,
    version: false,
    dryRun: false,
    plain: false,
    json: false,
    noInput: false,
    debug: false,
    input: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) break;
    if (value === "--help" || value === "-h") {
      cli.help = true;
    } else if (value === "--init") {
      cli.init = true;
    } else if (value === "--version" || value === "-v") {
      cli.version = true;
    } else if (value === "--dry-run" || value === "-n") {
      cli.dryRun = true;
    } else if (value === "--plain") {
      cli.plain = true;
    } else if (value === "--json") {
      cli.json = true;
      cli.noInput = true;
    } else if (value === "--no-input") {
      cli.noInput = true;
    } else if (value === "--debug") {
      cli.debug = true;
    } else if (value === "--analyze") {
      cli.analyze = true;
    } else if (value === "--eval") {
      cli.evaluate = true;
    } else if (value === "--eval-record") {
      cli.evalRecord = true;
    } else if (value === "--live") {
      cli.live = true;
    } else if (value === "--recompile") {
      const phase = requireArgument(args, ++index, "--recompile");
      if (phase !== "plan" && phase !== "tasks" && phase !== "execute") {
        throw new Error("--recompile must be 'plan', 'tasks', or 'execute'");
      }
      cli.recompile = phase;
    } else if (value === "--stage") {
      cli.stage = requireArgument(args, ++index, "--stage");
    } else if (value === "--lang") {
      const language = requireArgument(args, ++index, "--lang");
      if (language !== "en" && language !== "ru") throw new Error("--lang must be 'en' or 'ru'");
      cli.language = language;
    } else if (value === "--max-calls") {
      const raw = requireArgument(args, ++index, "--max-calls");
      const calls = Number(raw);
      if (!Number.isInteger(calls) || calls < 1) {
        throw new Error("--max-calls must be a positive integer");
      }
      cli.maxCalls = calls;
    } else if (value === "--thinking") {
      const mode = requireArgument(args, ++index, "--thinking");
      if (mode !== "on" && mode !== "off") {
        throw new Error("--thinking must be 'on' or 'off'");
      }
      cli.thinking = mode === "on";
    } else if (value === "--") {
      cli.input.push(...args.slice(index + 1));
      break;
    } else if (value.startsWith("-")) {
      throw new Error(`Unknown option: ${value}. Run sddc --help.`);
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
