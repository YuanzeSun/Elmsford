import type { CalendarData, FastReason, FeastDef, FeastRank, FeastRule, LiturgicalSeason } from "./calendarTypes";
import { adventSundayDayNumber, dayNumber, easterDayNumber, fromDayNumber, isLeapYear, weekdayOf } from "./dates";

export interface FeastRef {
  id: string;
  name: string;
  rank: FeastRank;
  holyDay: boolean;
  note?: string;
}

export interface LiturgicalDay {
  /** Today's feasts, highest rank first. */
  feasts: FeastRef[];
  /** Set when tomorrow is a principal or major feast. */
  eveOf?: FeastRef;
  /** The most recent feast before today, for "圣某某节后第几天". */
  anchor?: { feast: FeastRef; daysAfter: number };
  season: LiturgicalSeason;
  isSunday: boolean;
  holyDay: boolean;
  fasting: FastReason[];
}

const RANK_ORDER: Record<FeastRank, number> = { principal: 0, major: 1, minor: 2 };
const ANCHOR_LOOKBACK_DAYS = 120;

function resolveRule(rule: FeastRule, year: number): number {
  switch (rule.kind) {
    case "fixed":
      return dayNumber(year, rule.month, rule.leapDay && isLeapYear(year) ? rule.leapDay : rule.day);
    case "easter":
      return easterDayNumber(year) + rule.offset;
    case "advent":
      return adventSundayDayNumber(year) + rule.offset;
    case "weekdayAfter": {
      const base = dayNumber(year, rule.month, rule.day);
      const delta = (rule.weekday - weekdayOf(base) + 7) % 7 || 7;
      return base + delta;
    }
  }
}

function toRef(def: FeastDef): FeastRef {
  return {
    id: def.id,
    name: def.name,
    rank: def.rank,
    holyDay: def.holyDay ?? false,
    ...(def.note ? { note: def.note } : {}),
  };
}

const yearCache = new WeakMap<CalendarData, Map<number, Map<number, FeastDef[]>>>();

/** All feasts falling in a civil year, keyed by day number. */
function feastsByDay(cal: CalendarData, year: number): Map<number, FeastDef[]> {
  let perCal = yearCache.get(cal);
  if (!perCal) {
    perCal = new Map();
    yearCache.set(cal, perCal);
  }
  let byDay = perCal.get(year);
  if (!byDay) {
    byDay = new Map();
    for (const def of cal.feasts) {
      const n = resolveRule(def.rule, year);
      if (fromDayNumber(n).year !== year) continue; // advent/easter offsets never cross years, but be safe
      const list = byDay.get(n) ?? [];
      list.push(def);
      byDay.set(n, list);
    }
    for (const list of byDay.values()) list.sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    perCal.set(year, byDay);
  }
  return byDay;
}

export function feastsOn(cal: CalendarData, n: number): FeastDef[] {
  return feastsByDay(cal, fromDayNumber(n).year).get(n) ?? [];
}

function seasonOf(n: number, year: number): LiturgicalSeason {
  const easter = easterDayNumber(year);
  const advent = adventSundayDayNumber(year);
  const christmas = dayNumber(year, 12, 25);
  const epiphany = dayNumber(year, 1, 6);

  if (n >= christmas || n < epiphany) return "christmastide";
  if (n >= advent) return "advent";
  if (n < easter - 63) return "epiphany";
  if (n < easter - 46) return "septuagesima";
  if (n < easter) return "lent";
  if (n < easter + 56) return "eastertide";
  return "trinity";
}

function isEmberDay(cal: CalendarData, n: number, year: number): boolean {
  const weekday = weekdayOf(n);
  if (weekday !== 3 && weekday !== 5 && weekday !== 6) return false;
  return cal.emberAnchors.some((rule) => {
    const anchor = resolveRule(rule, year);
    const wednesday = anchor + ((3 - weekdayOf(anchor) + 7) % 7 || 7);
    return n === wednesday || n === wednesday + 2 || n === wednesday + 3;
  });
}

export function liturgicalDay(cal: CalendarData, n: number): LiturgicalDay {
  const { year } = fromDayNumber(n);
  const todays = feastsOn(cal, n);
  const tomorrows = feastsOn(cal, n + 1);
  const isSunday = weekdayOf(n) === 0;

  const eve = tomorrows.find((f) => f.rank !== "minor");

  let anchor: LiturgicalDay["anchor"];
  for (let back = 1; back <= ANCHOR_LOOKBACK_DAYS; back++) {
    const found = feastsOn(cal, n - back)[0];
    if (found) {
      anchor = { feast: toRef(found), daysAfter: back };
      break;
    }
  }

  const season = seasonOf(n, year);
  const isChristmasDay = n === dayNumber(year, 12, 25);
  const fasting: FastReason[] = [];
  if (!isSunday) {
    if (weekdayOf(n) === 5 && !isChristmasDay) fasting.push("friday");
    if (season === "lent") fasting.push("lent");
    if (isEmberDay(cal, n, year)) fasting.push("ember");
    if (tomorrows.some((f) => f.fastingEve) && todays.every((f) => f.rank === "minor")) fasting.push("vigil");
  }

  return {
    feasts: todays.map(toRef),
    ...(eve ? { eveOf: toRef(eve) } : {}),
    ...(anchor ? { anchor } : {}),
    season,
    isSunday,
    holyDay: isSunday || todays.some((f) => f.holyDay),
    fasting,
  };
}
