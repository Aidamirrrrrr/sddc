import { t } from "../ui/language";

/**
 * Running token totals for one session.
 *
 * Prefix caching is invisible unless it is measured: a change that looks like a saving can quietly
 * stop working when a prompt stops being byte-stable, and only the cached-token share shows it.
 */
export type Usage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

const totals: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

export function recordUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}): void {
  totals.calls += 1;
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  totals.cachedInputTokens += usage.cachedInputTokens ?? 0;
}

export function sessionUsage(): Usage {
  return { ...totals };
}

export function resetUsage(): void {
  totals.calls = 0;
  totals.inputTokens = 0;
  totals.outputTokens = 0;
  totals.cachedInputTokens = 0;
}

/** `undefined` when the provider reports no cache information at all. */
export function cacheHitRate(usage: Usage): number | undefined {
  if (usage.inputTokens === 0) return undefined;
  return usage.cachedInputTokens / usage.inputTokens;
}

export function formatUsage(usage: Usage, inputUsdPerMillion?: number): string {
  const rate = cacheHitRate(usage);
  const parts = [
    t({ en: `${usage.calls} model calls`, ru: `вызовов модели: ${usage.calls}` }),
    t({
      en: `${usage.inputTokens.toLocaleString()} in`,
      ru: `вход ${usage.inputTokens.toLocaleString()}`,
    }),
    t({
      en: `${usage.outputTokens.toLocaleString()} out`,
      ru: `выход ${usage.outputTokens.toLocaleString()}`,
    }),
  ];
  if (rate !== undefined && usage.cachedInputTokens > 0) {
    parts.push(
      t({
        en: `${Math.round(rate * 100)}% of input served from cache`,
        ru: `${Math.round(rate * 100)}% входа из кэша`,
      }),
    );
  }
  if (inputUsdPerMillion !== undefined) {
    // Cached input is billed at a discount that varies by provider, so bill it as full price here
    // and let the reported cache share explain why the invoice is lower.
    const cost = (usage.inputTokens / 1_000_000) * inputUsdPerMillion;
    parts.push(
      t({ en: `~$${cost.toFixed(4)} uncached input`, ru: `~$${cost.toFixed(4)} за вход без кэша` }),
    );
  }
  return parts.join(" · ");
}
