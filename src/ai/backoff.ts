import { APICallError } from "@ai-sdk/provider";

/**
 * Retries transport failures, which are a different problem from a bad response.
 *
 * A rate limit or a gateway error says nothing about the prompt, so re-asking the model to correct
 * itself is wasted budget; waiting and repeating the identical request is the fix. Schema failures
 * keep going to withOneRepair instead.
 */
export type BackoffOptions = {
  attempts?: number;
  baseDelayMs?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so retry delays are reproducible in tests. */
  jitter?: () => number;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export function isTransient(error: unknown): boolean {
  // The provider already classifies its own failures; trust that before guessing from text.
  if (APICallError.isInstance(error)) {
    if (error.isRetryable) return true;
    const status = error.statusCode;
    return status === 408 || status === 409 || status === 429 || (status ?? 0) >= 500;
  }
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket hang up/i.test(
    message,
  );
}

export async function withBackoff<T>(
  operation: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const jitter = options.jitter ?? Math.random;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      // Full jitter: synchronized clients must not retry in lockstep and rebuild the spike.
      await sleep(Math.round(base * 2 ** (attempt - 1) * (0.5 + jitter() * 0.5)));
    }
  }
}
