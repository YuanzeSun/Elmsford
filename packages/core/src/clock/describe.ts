// Player-facing sentences about the time, the way a villager would reckon it.

import type { CalendarData } from "./calendarTypes";
import type { GameTime } from "./gameTime";

const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1 → 一, 12 → 十二, 20 → 二十, 37 → 三十七. Supports 0–999. */
export function chineseNumeral(n: number): string {
  if (n < 10) return DIGITS[n]!;
  if (n < 20) return "十" + (n % 10 ? DIGITS[n % 10] : "");
  if (n < 100) return DIGITS[Math.floor(n / 10)] + "十" + (n % 10 ? DIGITS[n % 10] : "");
  const rest = n % 100;
  const head = DIGITS[Math.floor(n / 100)] + "百";
  if (rest === 0) return head;
  return head + (rest < 10 ? "零" + DIGITS[rest] : rest < 20 ? "一" + chineseNumeral(rest) : chineseNumeral(rest));
}

/** "十月二十日" — the date as a villager would say it, without the year. */
export function chineseDate(month: number, day: number): string {
  return `${chineseNumeral(month)}月${chineseNumeral(day)}日`;
}

export function formatClock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** "今天是圣路加节后第二天" / "今天是圣西门与圣犹大节" / "今天是诸圣节前夕" */
export function describeDay(gt: GameTime): string {
  const { feasts, eveOf, anchor } = gt.liturgical;
  if (feasts[0]) return `今天是${feasts[0].name}`;
  if (eveOf) return `今天是${eveOf.name}前夕`;
  if (anchor) {
    if (anchor.daysAfter === 1) return `今天是${anchor.feast.name}次日`;
    return `今天是${anchor.feast.name}后第${chineseNumeral(anchor.daysAfter)}天`;
  }
  return "今天是个寻常日子";
}

const JUST_RANG_MINUTES = 20;
const RECENT_MINUTES = 90;
const SOON_MINUTES = 30;

/** "刚敲过晚祷钟" / "快敲午钟了" / "熄火钟敲过很久了" */
export function describeBell(gt: GameTime, cal: CalendarData): string {
  const { last, next } = gt.bells;
  const lastName = cal.bellNames[last.id];
  if (last.minutesAgo < JUST_RANG_MINUTES) return `刚敲过${lastName}`;
  if (next.minutesUntil <= SOON_MINUTES) return `快敲${cal.bellNames[next.id]}了`;
  if (last.minutesAgo < RECENT_MINUTES) return `${lastName}敲过不久`;
  return `${lastName}敲过很久了`;
}

export interface TimeDescription {
  /** "今天是圣路加节后第二天，刚敲过晚祷钟。" */
  headline: string;
  /** "十月二十日" */
  dateText: string;
  weekday: string;
  period: string;
  season: string;
  clock: string;
  sunrise: string;
  sunset: string;
  /** e.g. "今天守斋：星期五。" — empty when not a fast day */
  fasting: string;
  /** Today's feast notes, if any. */
  feastNotes: string[];
  agrarian: readonly string[];
  /** Today's bells, e.g. { name: "晨钟", clock: "6:31" }. */
  bells: { name: string; clock: string }[];
}

export function describeTime(gt: GameTime, cal: CalendarData): TimeDescription {
  const reasons = gt.liturgical.fasting.map((r) =>
    r === "vigil" && gt.liturgical.eveOf ? `${gt.liturgical.eveOf.name}${cal.fastReasonNames.vigil}` : cal.fastReasonNames[r],
  );
  return {
    headline: `${describeDay(gt)}，${describeBell(gt, cal)}。`,
    dateText: chineseDate(gt.month, gt.day),
    weekday: cal.weekdayNames[gt.weekday]!,
    period: cal.periodNames[gt.period],
    season: cal.seasonNames[gt.liturgical.season],
    clock: formatClock(gt.minuteOfDay),
    sunrise: formatClock(gt.sun.sunrise),
    sunset: formatClock(gt.sun.sunset),
    fasting: reasons.length ? `今天守斋：${reasons.join("，")}。` : "",
    feastNotes: gt.liturgical.feasts.flatMap((f) => (f.note ? [f.note] : [])),
    agrarian: gt.agrarian,
    bells: gt.bells.today.map((b) => ({ name: cal.bellNames[b.id], clock: formatClock(b.minute) })),
  };
}
