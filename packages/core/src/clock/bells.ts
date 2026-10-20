import type { BellId } from "./calendarTypes";
import type { SunTimes } from "./sun";

export interface BellRing {
  id: BellId;
  /** Wall-clock minute of the day. */
  minute: number;
}

const EARLIEST_CURFEW = 20 * 60;
const LATEST_CURFEW = 22 * 60;

/**
 * The parish bells for one day, in wall-clock minutes. Hours are "unequal": a temporal hour is
 * one twelfth of the daylight, so terce and vespers drift with the season.
 */
export function bellsForDay(sun: SunTimes, dstMinutes: number, holyDay: boolean): BellRing[] {
  const temporalHour = sun.dayLength / 12;
  const curfewStandard = Math.min(LATEST_CURFEW, Math.max(EARLIEST_CURFEW, sun.civilDusk + 30));
  const rings: BellRing[] = [
    { id: "dawn", minute: sun.sunrise },
    { id: "noon", minute: sun.solarNoon },
    { id: "vespers", minute: sun.sunset - temporalHour },
    { id: "curfew", minute: curfewStandard },
  ];
  if (holyDay) rings.push({ id: "mass", minute: sun.sunrise + 3 * temporalHour });
  return rings
    .map((r) => ({ id: r.id, minute: Math.round(r.minute + dstMinutes) }))
    .sort((a, b) => a.minute - b.minute);
}

export interface BellStatus {
  last: BellRing & { minutesAgo: number };
  next: BellRing & { minutesUntil: number };
}

/** Last and next bell around `minuteOfDay`, wrapping to yesterday's curfew / tomorrow's dawn bell. */
export function bellStatus(today: BellRing[], minuteOfDay: number): BellStatus {
  const first = today[0]!;
  const final = today[today.length - 1]!;
  const last = [...today].reverse().find((r) => r.minute <= minuteOfDay) ?? { ...final, minute: final.minute - 1440 };
  const next = today.find((r) => r.minute > minuteOfDay) ?? { ...first, minute: first.minute + 1440 };
  return {
    last: { ...last, minutesAgo: minuteOfDay - last.minute },
    next: { ...next, minutesUntil: next.minute - minuteOfDay },
  };
}
