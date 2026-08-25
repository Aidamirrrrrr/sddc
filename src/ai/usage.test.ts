import { beforeEach, expect, test } from "bun:test";
import { cacheHitRate, formatUsage, recordUsage, resetUsage, sessionUsage } from "./usage";

beforeEach(resetUsage);

test("usage accumulates across calls", () => {
  recordUsage({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 });
  recordUsage({ inputTokens: 1000, outputTokens: 150, cachedInputTokens: 900 });

  expect(sessionUsage()).toEqual({
    calls: 2,
    inputTokens: 2000,
    outputTokens: 250,
    cachedInputTokens: 900,
  });
  expect(cacheHitRate(sessionUsage())).toBeCloseTo(0.45);
});

test("a provider that reports no cache information yields no rate", () => {
  expect(cacheHitRate({ calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 })).toBe(
    undefined,
  );
});

test("the summary mentions the cache only when the provider served from it", () => {
  recordUsage({ inputTokens: 1000, outputTokens: 100 });
  expect(formatUsage(sessionUsage())).not.toContain("cache");

  recordUsage({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 1000 });
  expect(formatUsage(sessionUsage())).toContain("50% of input served from cache");
});
