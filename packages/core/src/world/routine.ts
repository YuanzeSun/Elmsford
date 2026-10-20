// Routines: a resident's ordinary day, written against the bells rather than the clock so it
// follows the season. Used as the fallback day plan whenever no planned day exists.

import type { BellRing } from "../clock/bells";
import type { GameTime } from "../clock/gameTime";
import type { PlanBlock } from "./types";

/** "dawn", "noon+30", "vespers-60", "mass", "curfew", "06:30", "24:00" */
export type TimeAnchor = string;

export interface RoutineBlock {
  from: TimeAnchor;
  to: TimeAnchor;
  locationId: string;
  activity: string;
  asleep?: boolean;
  /** Only on these weekdays (0 = Sunday). */
  days?: number[];
}

export interface Routine {
  /** Ordinary working days. */
  workday: RoutineBlock[];
  /** Sundays and holy days: mass, no heavy work. */
  holyday: RoutineBlock[];
}

const ANCHOR = /^(dawn|noon|vespers|curfew|mass)?([+-]\d+)?$|^(\d{1,2}):(\d{2})$/;

export function resolveAnchor(anchor: TimeAnchor, bells: readonly BellRing[]): number | null {
  const m = ANCHOR.exec(anchor.trim());
  if (!m) return null;
  if (m[3] !== undefined) return Number(m[3]) * 60 + Number(m[4]);
  const base = m[1] ? bells.find((b) => b.id === m[1])?.minute : 0;
  if (base === undefined) return null;
  return base + (m[2] ? Number(m[2]) : 0);
}

export const toHHMM = (minute: number) => {
  const m = Math.max(0, Math.min(1440, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const fromHHMM = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 ? v : null;
};

/** The routine for one day as concrete plan blocks; gaps are filled with `fallback`. */
export function routineForDay(routine: Routine, gt: GameTime, fallback: Omit<PlanBlock, "from" | "to">): PlanBlock[] {
  const source = gt.liturgical.holyDay ? routine.holyday : routine.workday;
  const blocks: { from: number; to: number; b: RoutineBlock }[] = [];
  for (const b of source) {
    if (b.days && !b.days.includes(gt.weekday)) continue;
    const from = resolveAnchor(b.from, gt.bells.today);
    const to = resolveAnchor(b.to, gt.bells.today);
    if (from === null || to === null || to <= from) continue;
    blocks.push({ from, to, b });
  }
  blocks.sort((x, y) => x.from - y.from);

  const out: PlanBlock[] = [];
  let cursor = 0;
  for (const { from, to, b } of blocks) {
    const start = Math.max(from, cursor);
    if (start >= to) continue;
    if (start > cursor) out.push({ from: toHHMM(cursor), to: toHHMM(start), ...fallback });
    out.push({ from: toHHMM(start), to: toHHMM(to), locationId: b.locationId, activity: b.activity, ...(b.asleep ? { asleep: true } : {}) });
    cursor = to;
  }
  if (cursor < 1440) out.push({ from: toHHMM(cursor), to: "24:00", ...fallback });
  return out;
}

/** The block covering a minute of the day. */
export function blockAt(blocks: readonly PlanBlock[], minuteOfDay: number): PlanBlock | undefined {
  return blocks.find((b) => {
    const from = fromHHMM(b.from);
    const to = fromHHMM(b.to);
    return from !== null && to !== null && minuteOfDay >= from && minuteOfDay < to;
  });
}

/** The block after the one covering a minute, if the person goes somewhere else next. */
export function nextBlock(blocks: readonly PlanBlock[], minuteOfDay: number): PlanBlock | undefined {
  const i = blocks.findIndex((b) => {
    const from = fromHHMM(b.from) ?? 0;
    const to = fromHHMM(b.to) ?? 0;
    return minuteOfDay >= from && minuteOfDay < to;
  });
  return i >= 0 ? blocks[i + 1] : undefined;
}
