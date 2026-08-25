import { expect, test } from "bun:test";
import { APICallError } from "@ai-sdk/provider";
import { isTransient, withBackoff } from "./backoff";

function apiError(statusCode: number, isRetryable = false): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://example.invalid/v1",
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

/** Records the delays instead of waiting them out. */
function recorder() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    jitter: () => 1,
  };
}

test("rate limits and gateway errors are transient", () => {
  expect(isTransient(apiError(429))).toBe(true);
  expect(isTransient(apiError(503))).toBe(true);
  expect(isTransient(apiError(408))).toBe(true);
  expect(isTransient(new Error("fetch failed"))).toBe(true);
  expect(isTransient(new Error("connect ECONNRESET"))).toBe(true);
});

test("a rejected request is not transient and must not be repeated", () => {
  expect(isTransient(apiError(400))).toBe(false);
  expect(isTransient(apiError(401))).toBe(false);
  expect(isTransient(new Error("No output generated."))).toBe(false);
});

test("the provider's own retryable flag wins over the status code", () => {
  expect(isTransient(apiError(418, true))).toBe(true);
});

test("a transient failure is retried and the delay grows", async () => {
  const clock = recorder();
  let calls = 0;

  const result = await withBackoff(
    async () => {
      calls += 1;
      if (calls < 3) throw apiError(429);
      return "ok";
    },
    { baseDelayMs: 100, ...clock },
  );

  expect(result).toBe("ok");
  expect(calls).toBe(3);
  expect(clock.delays).toEqual([100, 200]);
});

test("a permanent failure is thrown on the first attempt", async () => {
  const clock = recorder();
  let calls = 0;

  const attempt = withBackoff(
    async () => {
      calls += 1;
      throw apiError(400);
    },
    { ...clock },
  );

  expect(attempt).rejects.toThrow("HTTP 400");
  expect(calls).toBe(1);
  expect(clock.delays).toEqual([]);
});

test("retries stop at the attempt limit and surface the last error", async () => {
  const clock = recorder();
  let calls = 0;

  const attempt = withBackoff(
    async () => {
      calls += 1;
      throw apiError(503);
    },
    { attempts: 3, baseDelayMs: 10, ...clock },
  );

  expect(attempt).rejects.toThrow("HTTP 503");
  expect(calls).toBe(3);
});
