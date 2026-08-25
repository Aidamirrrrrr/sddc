const MAX_ATTEMPTS = 2;

/**
 * The provider reports an exhausted output budget as a missing object rather than as a schema
 * violation: reasoning tokens consume the same budget, so a heavy stage can spend all of it before
 * emitting any JSON.
 */
const EMPTY_OUTPUT = /no (?:output|object) generated|could not parse/i;

/** `degraded` asks the caller to spend the whole budget on the answer instead of on reasoning. */
export type RetryOptions = { degraded: boolean };

export async function withOneRepair<T>(
  originalPrompt: string,
  generate: (prompt: string, options: RetryOptions) => Promise<T>,
): Promise<T> {
  let currentPrompt = originalPrompt;
  let degraded = false;
  let previousError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await generate(currentPrompt, { degraded });
    } catch (error) {
      previousError = error;
      if (attempt > 0) continue;
      // An empty response carries no mistake to correct, so repair instructions would only consume
      // more of the budget that just ran out. Retry the original prompt with reasoning turned down.
      degraded = isEmptyOutput(error);
      currentPrompt = degraded ? originalPrompt : buildRepairPrompt(originalPrompt, error);
    }
  }

  throw previousError;
}

export function isEmptyOutput(error: unknown): boolean {
  return EMPTY_OUTPUT.test(errorSummary(error));
}

function buildRepairPrompt(originalPrompt: string, error: unknown): string {
  return `${originalPrompt}

Your previous response could not be accepted.
Validation error: ${errorSummary(error)}
Return a corrected response that follows the system instructions and output schema exactly.
Do not explain the correction and do not wrap the response in Markdown.`;
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause === undefined ? "" : String(error.cause);
    return [error.message, cause].filter(Boolean).join(": ").slice(0, 1_000);
  }
  return String(error).slice(0, 1_000);
}
