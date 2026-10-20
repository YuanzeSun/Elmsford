// 每天的进项和开销（只求合理，单位便士）。规则按天结算，不经过 LLM。

export interface DailyEconomy {
  /** Typical earnings on a working day, [min, max]. */
  workday: [number, number];
  /** Earnings on Sundays and holy days. */
  holyday: [number, number];
  /** Food and the like, every day. */
  spend: number;
}

export const economy: Record<string, DailyEconomy> = {
  matilda: { workday: [3, 7], holyday: [5, 10], spend: 2 },
  thomas: { workday: [2, 4], holyday: [0, 0], spend: 3 },
  edmund: { workday: [0, 1], holyday: [3, 6], spend: 1 },
  joan: { workday: [1, 3], holyday: [0, 0], spend: 1 },
  hubert: { workday: [0, 0], holyday: [0, 1], spend: 0 },
};

/** Below this many pence, money becomes a worry. */
export const MONEY_WORRY_PENCE = 6;
export const MONEY_WORRY = "手头紧，钱快花光了";
