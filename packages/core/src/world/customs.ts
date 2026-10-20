// Customs: what the days mean to the village — feasts, fasts, seasons, bells. Never explained to
// the player outright. They show as things to see around the village (signs), live in residents'
// heads (lore, and what a day means to each of them), and reach the notebook only when someone
// actually tells the player.

import type { BellId, CalendarData, FastReason, LiturgicalSeason, Period } from "../clock/calendarTypes";
import type { GameTime } from "../clock/gameTime";
import { feastsOn } from "../clock/liturgical";

export type CustomWhen = { feast: string } | { season: LiturgicalSeason } | { fast: FastReason } | { bell: BellId };

export interface CustomSign {
  /** Where it can be seen; omitted means anywhere. */
  at?: string[];
  /** For feasts: days relative to the feast, inclusive (0 = the day, -1 = the day before). Default [0, 0]. */
  days?: [number, number];
  /** Only at these times of day. */
  periods?: Period[];
  text: string;
}

export interface Custom {
  key: string;
  /** As written in the notebook, e.g. "万灵节". */
  name: string;
  when: CustomWhen;
  /** What everyone in the village knows. For residents and planners; never shown as is. */
  lore: string;
  /** How it touches particular residents. */
  personal?: Record<string, string>;
  signs?: CustomSign[];
}

export interface CustomInEffect {
  custom: Custom;
  /** For feasts: today minus the feast day (negative = still to come). 0 otherwise. */
  offset: number;
}

/** A bell custom holds for this long after the bell. */
const BELL_WINDOW_MINUTES = 60;

/**
 * Customs that touch today: feasts from `ahead` days before to `after` days after, the season,
 * today's fasts, and a bell that rang within the hour.
 */
export function customsAround(gt: GameTime, cal: CalendarData, customs: readonly Custom[], ahead = 3, after = 1): CustomInEffect[] {
  const out: CustomInEffect[] = [];
  for (const custom of customs) {
    const w = custom.when;
    if ("feast" in w) {
      for (let offset = -ahead; offset <= after; offset++) {
        if (feastsOn(cal, gt.dayNumber - offset).some((f) => f.id === w.feast)) out.push({ custom, offset });
      }
    } else if ("season" in w) {
      if (gt.liturgical.season === w.season) out.push({ custom, offset: 0 });
    } else if ("fast" in w) {
      if (gt.liturgical.fasting.includes(w.fast)) out.push({ custom, offset: 0 });
    } else if (gt.bells.last.id === w.bell && gt.bells.last.minutesAgo < BELL_WINDOW_MINUTES) {
      out.push({ custom, offset: 0 });
    }
  }
  return out.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
}

/** What can be seen right here, right now: at most `limit`, those tied to this place first. */
export function signsHere(inEffect: readonly CustomInEffect[], locationId: string, period: Period, limit = 2): string[] {
  const hits: { text: string; specific: boolean }[] = [];
  for (const { custom, offset } of inEffect) {
    for (const s of custom.signs ?? []) {
      const [from, to] = "feast" in custom.when ? (s.days ?? [0, 0]) : [offset, offset];
      if (offset < from || offset > to) continue;
      if (s.periods && !s.periods.includes(period)) continue;
      if (s.at && !s.at.includes(locationId)) continue;
      hits.push({ text: s.text, specific: Boolean(s.at) });
    }
  }
  hits.sort((a, b) => Number(b.specific) - Number(a.specific));
  return [...new Set(hits.map((h) => h.text))].slice(0, limit);
}
