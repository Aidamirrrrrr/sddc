const MAX_ATTEMPTS = 2;

export async function withOneRepair<T>(
  originalPrompt: string,
  generate: (prompt: string) => Promise<T>,
): Promise<T> {
  let currentPrompt = originalPrompt;
  let previousError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await generate(currentPrompt);
    } catch (error) {
      previousError = error;
      if (attempt === 0) currentPrompt = buildRepairPrompt(originalPrompt, error);
    }
  }

  throw previousError;
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
