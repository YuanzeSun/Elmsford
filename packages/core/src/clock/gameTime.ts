import { bellsForDay, bellStatus, type BellRing, type BellStatus } from "./bells";
import type { CalendarData, Period } from "./calendarTypes";
import { dateKey, dayNumber, weekdayOf } from "./dates";
import { liturgicalDay, type LiturgicalDay } from "./liturgical";
import { sunTimes } from "./sun";
import { standardOffsetMinutes, zonedParts } from "./timezone";

export type Light = "day" | "twilight" | "night";

export interface GameTime {
  /** Epoch milliseconds. Persist this; everything else is derived. */
  instant: number;
  timeZone: string;
  /** Local civil date, YYYY-MM-DD. */
  date: string;
  dayNumber: number;
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday */
  weekday: number;
  hour: number;
  minute: number;
  minuteOfDay: number;
  /** Wall-clock minutes of sun events today (DST applied). */
  sun: { civilDawn: number; sunrise: number; solarNoon: number; sunset: number; civilDusk: number };
  dayLengthMinutes: number;
  light: Light;
  period: Period;
  bells: { today: BellRing[] } & BellStatus;
  liturgical: LiturgicalDay;
  /** What the village is busy with this month. */
  agrarian: readonly string[];
}

function periodAt(m: number, sun: GameTime["sun"], vespers: number, curfew: number): Period {
  if (m < sun.civilDawn) return "deep_night";
  if (m < sun.sunrise + 60) return "dawn";
  if (m < sun.solarNoon - 30) return "morning";
  if (m < sun.solarNoon + 30) return "noon";
  if (m < vespers) return "afternoon";
  if (m < curfew) return "evening";
  return "night";
}

function lightAt(m: number, sun: GameTime["sun"]): Light {
  if (m >= sun.sunrise && m < sun.sunset) return "day";
  if (m >= sun.civilDawn && m < sun.civilDusk) return "twilight";
  return "night";
}

export function computeGameTime(instant: number, timeZone: string, cal: CalendarData): GameTime {
  const p = zonedParts(instant, timeZone);
  const n = dayNumber(p.year, p.month, p.day);
  const dst = p.offsetMinutes - standardOffsetMinutes(p.year, timeZone);
  const minuteOfDay = p.hour * 60 + p.minute + p.second / 60;

  const raw = sunTimes(p.year, p.month, p.day);
  const sun = {
    civilDawn: raw.civilDawn + dst,
    sunrise: raw.sunrise + dst,
    solarNoon: raw.solarNoon + dst,
    sunset: raw.sunset + dst,
    civilDusk: raw.civilDusk + dst,
  };

  const liturgical = liturgicalDay(cal, n);
  const today = bellsForDay(raw, dst, liturgical.holyDay);
  const vespers = today.find((b) => b.id === "vespers")!.minute;
  const curfew = today.find((b) => b.id === "curfew")!.minute;

  return {
    instant,
    timeZone,
    date: dateKey(p),
    dayNumber: n,
    year: p.year,
    month: p.month,
    day: p.day,
    weekday: weekdayOf(n),
    hour: p.hour,
    minute: p.minute,
    minuteOfDay: Math.floor(minuteOfDay),
    sun,
    dayLengthMinutes: raw.dayLength,
    light: lightAt(minuteOfDay, sun),
    period: periodAt(minuteOfDay, sun, vespers, curfew),
    bells: { today, ...bellStatus(today, minuteOfDay) },
    liturgical,
    agrarian: cal.agrarianByMonth[p.month - 1] ?? [],
  };
}
