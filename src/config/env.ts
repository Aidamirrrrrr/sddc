import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ModelConfig = {
  apiUrl: string;
  apiToken: string;
  model: string;
  maxOutputTokens: number;
};

/**
 * Audit and review stages carry the whole upstream context, and reasoning tokens are billed against
 * this same budget, so it has to leave room for the structured answer after the model has thought.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const MINIMUM_MAX_OUTPUT_TOKENS = 1_024;

export function loadModelConfig(): ModelConfig {
  return {
    apiUrl: requiredEnv("AI_API_URL").replace(/\/+$/, ""),
    apiToken: requiredEnv("AI_API_TOKEN"),
    model: requiredEnv("AI_MODEL"),
    maxOutputTokens: loadMaxOutputTokens(),
  };
}

export function loadMaxOutputTokens(): number {
  const value = Bun.env.AI_MAX_OUTPUT_TOKENS?.trim();
  if (!value) return DEFAULT_MAX_OUTPUT_TOKENS;
  const tokens = Number(value);
  if (!Number.isInteger(tokens) || tokens < MINIMUM_MAX_OUTPUT_TOKENS) {
    throw new Error(
      `AI_MAX_OUTPUT_TOKENS must be an integer of at least ${MINIMUM_MAX_OUTPUT_TOKENS}`,
    );
  }
  return tokens;
}

export function userConfigPath(): string {
  const base = Bun.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "sddc", ".env");
}

export async function loadUserEnvironment(): Promise<void> {
  const file = Bun.file(userConfigPath());
  if (!(await file.exists())) return;
  for (const [name, value] of parseEnvironment(await file.text())) {
    if (!Bun.env[name]) Bun.env[name] = value;
  }
}

export async function initializeUserConfig(): Promise<{ path: string; created: boolean }> {
  const path = userConfigPath();
  const file = Bun.file(path);
  if (await file.exists()) return { path, created: false };
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(
    path,
    [
      "AI_API_TOKEN=",
      "AI_API_URL=",
      "AI_MODEL=",
      "AI_INPUT_USD_PER_MILLION=",
      "AI_MAX_OUTPUT_TOKENS=",
      "SDDC_LANG=",
      "",
    ].join("\n"),
  );
  await chmod(path, 0o600);
  return { path, created: true };
}

export function loadInputPrice(): number | undefined {
  const value = Bun.env.AI_INPUT_USD_PER_MILLION?.trim();
  if (!value) return undefined;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("AI_INPUT_USD_PER_MILLION must be a non-negative number");
  }
  return price;
}

function requiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured. Run 'sddc --init' and edit ${userConfigPath()}`);
  }
  return value;
}

function parseEnvironment(source: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    entries.push([name, value]);
  }
  return entries;
}
