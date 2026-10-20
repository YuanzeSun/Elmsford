// Reference prices for budget accounting only (USD per million tokens, first-party list prices).
// A relay may bill differently, so treat cost figures as estimates. Model choice lives in config.

import type { Usage } from "./types";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // DeepSeek list prices have moved several times; these sit at the high end of what they've been.
  "deepseek-chat": { input: 0.56, output: 1.68, cacheRead: 0.07, cacheWrite: 0.56 },
  "deepseek-reasoner": { input: 0.56, output: 1.68, cacheRead: 0.07, cacheWrite: 0.56 },
};

/** Unknown models are costed high on purpose, so the budget errs toward stopping early. */
const UNKNOWN: Price = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export function priceKnown(model: string): boolean {
  return model in PRICES;
}

export function estimateCostUsd(model: string, usage: Usage): number {
  const p = PRICES[model] ?? UNKNOWN;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
