import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ModelConfig = {
  apiUrl: string;
  apiToken: string;
  model: string;
  /** Undefined sends no cap at all, leaving the model's own maximum in force. */
  maxOutputTokens: number | undefined;
  /** How long one request may stay open before it is treated as lost. */
  requestTimeoutMs: number;
};

/**
 * How much room a stage gets for its answer.
 *
 * This is the completion cap, not the context window: the window is an input limit we never set,
 * and a model's maximum output is an order of magnitude smaller than it. Reasoning tokens are
 * charged against this same budget, so a heavy stage can spend the whole thing thinking and return
 * no JSON — which is what the default is sized to avoid.
 *
 * It stays a default rather than being removed because an uncapped completion against a per-token
 * endpoint is an open-ended bill. `AI_MAX_OUTPUT_TOKENS=off` removes it deliberately.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
const MINIMUM_MAX_OUTPUT_TOKENS = 1_024;
const UNCAPPED = new Set(["off", "none", "max", "0"]);

export function loadModelConfig(): ModelConfig {
  return {
    apiUrl: requiredEnv("AI_API_URL").replace(/\/+$/, ""),
    apiToken: requiredEnv("AI_API_TOKEN"),
    model: requiredEnv("AI_MODEL"),
    maxOutputTokens: loadMaxOutputTokens(),
    requestTimeoutMs: loadRequestTimeout(),
  };
}

/**
 * How long to wait for a response that may never come.
 *
 * A connection that opens and then goes quiet is indistinguishable from a slow model, and nothing
 * below this line can tell them apart — so an unattended run sat on one for seven minutes and would
 * have sat on it forever. Generous, because a reasoning stage on a long context genuinely takes
 * minutes; the point is a bound, not a tight one.
 */
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 300;

export function loadRequestTimeout(): number {
  const value = Bun.env.AI_REQUEST_TIMEOUT_SECONDS?.trim();
  if (!value) return DEFAULT_REQUEST_TIMEOUT_SECONDS * 1_000;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 10) {
    throw new Error("AI_REQUEST_TIMEOUT_SECONDS must be an integer of at least 10");
  }
  return seconds * 1_000;
}

export function loadMaxOutputTokens(): number | undefined {
  const value = Bun.env.AI_MAX_OUTPUT_TOKENS?.trim();
  if (!value) return DEFAULT_MAX_OUTPUT_TOKENS;
  if (UNCAPPED.has(value.toLocaleLowerCase())) return undefined;
  const tokens = Number(value);
  if (!Number.isInteger(tokens) || tokens < MINIMUM_MAX_OUTPUT_TOKENS) {
    throw new Error(
      `AI_MAX_OUTPUT_TOKENS must be "off" or an integer of at least ${MINIMUM_MAX_OUTPUT_TOKENS}`,
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
      "AI_REQUEST_TIMEOUT_SECONDS=",
      "SDDC_LANG=",
      "SDDC_THEME=",
      "",
    ].join("\n"),
  );
  await chmod(path, 0o600);
  return { path, created: true };
}

/**
 * Writes one setting back to the user's configuration.
 *
 * A preference that is asked for and then forgotten is not a preference — the language prompt
 * appeared on every single start because nothing ever recorded the answer. Rewrites the one line
 * and leaves every other byte alone, so a hand-edited file survives being written to.
 */
export async function saveUserSetting(name: string, value: string): Promise<void> {
  const path = userConfigPath();
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  const line = `${name}=${value}`;
  const lines = existing.split(/\r?\n/);
  const index = lines.findIndex((item) => item.trim().startsWith(`${name}=`));
  if (index >= 0) lines[index] = line;
  else {
    // Keep the trailing blank line at the end rather than in the middle of the file.
    const insertAt = lines.at(-1)?.trim() === "" ? lines.length - 1 : lines.length;
    lines.splice(insertAt, 0, line);
  }
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, lines.join("\n"));
  await chmod(path, 0o600);
  Bun.env[name] = value;
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
