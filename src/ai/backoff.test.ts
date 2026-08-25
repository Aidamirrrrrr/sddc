import { expect, test } from "bun:test";
import { APICallError } from "@ai-sdk/provider";
import { isTransient, withBackoff } from "./backoff";
import { requestInterrupt, resetInterrupt } from "./interrupt";

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

test("a handshake that dies mid-session is retried, verification untouched", () => {
  // Seen against a real endpoint: many calls succeed, then the link drops the TLS handshake.
  expect(isTransient(new Error("unknown certificate verification error"))).toBe(true);
  expect(isTransient(new Error("write EPROTO ... unexpected eof while reading"))).toBe(true);
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

test("a request that went quiet is retried; a cancelled one is not", () => {
  const timedOut = new Error("The operation timed out.");
  timedOut.name = "TimeoutError";

  // A connection that opens and stays silent is exactly what repeating fixes.
  expect(isTransient(timedOut)).toBe(true);

  requestInterrupt();
  try {
    // Once somebody has asked to stop, an abort looks the same from here as a lost connection —
    // only the interrupt state separates them, and retrying would argue with the person.
    expect(isTransient(timedOut)).toBe(false);
    expect(isTransient(new Error("fetch failed"))).toBe(false);
  } finally {
    resetInterrupt();
  }
});
