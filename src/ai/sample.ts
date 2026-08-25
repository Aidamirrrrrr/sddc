/**
 * Draws candidates until one satisfies the verifier.
 *
 * `temperature: 0` does not make a served model deterministic, so the same input yields different
 * graphs from one run to the next. That variance is only a problem while it is unmanaged: with a
 * free, deterministic verifier it becomes a resource — the wider the spread, the likelier some
 * sample is acceptable. Each rejection is fed back so the next draw is informed rather than blind.
 *
 * This is also the mechanism a distilled model would need for rejection sampling, so the pipeline
 * and the training loop end up sharing one implementation.
 */
export async function sampleUntilValid<T>(
  maxAttempts: number,
  generate: (rejection: string | undefined, attempt: number) => Promise<T>,
  verify: (value: T) => void | Promise<void>,
): Promise<T> {
  let rejection: string | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    const value = await generate(rejection, attempt);
    try {
      await verify(value);
      return value;
    } catch (error) {
      lastError = error;
      rejection = error instanceof Error ? error.message : String(error);
    }
  }
  throw lastError;
}
