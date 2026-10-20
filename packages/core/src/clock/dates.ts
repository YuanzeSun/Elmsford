// Civil-date arithmetic on "day numbers" (days since 1970-01-01, proleptic Gregorian).
// Liturgical and solar calculations work on whole days, so they never touch time zones.

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const MS_PER_DAY = 86_400_000;

export function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function fromDayNumber(n: number): CivilDate {
  const d = new Date(n * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(n: number): number {
  // 1970-01-01 was a Thursday.
  return (((n + 4) % 7) + 7) % 7;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function dayOfYear(year: number, month: number, day: number): number {
  return dayNumber(year, month, day) - dayNumber(year, 1, 1) + 1;
}

export function dateKey(d: CivilDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Gregorian Easter Sunday (anonymous Gregorian algorithm). */
export function easterDayNumber(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNumber(year, month, day);
}

/** First Sunday of Advent: the Sunday falling between 27 November and 3 December. */
export function adventSundayDayNumber(year: number): number {
  const dec3 = dayNumber(year, 12, 3);
  return dec3 - weekdayOf(dec3);
}
