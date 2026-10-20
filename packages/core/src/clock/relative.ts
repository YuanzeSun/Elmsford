// How a villager would say when something happened: "昨天傍晚", "三天前", "上个月".

import type { CalendarData } from "./calendarTypes";
import { chineseNumeral } from "./describe";
import { computeGameTime } from "./gameTime";

const PART_OF_DAY: Record<string, string> = {
  deep_night: "半夜",
  dawn: "早上",
  morning: "上午",
  noon: "中午",
  afternoon: "下午",
  evening: "傍晚",
  night: "夜里",
};

export function relativeTimePhrase(then: number, now: number, timeZone: string, cal: CalendarData): string {
  const a = computeGameTime(then, timeZone, cal);
  const b = computeGameTime(now, timeZone, cal);
  const days = b.dayNumber - a.dayNumber;
  const part = PART_OF_DAY[a.period] ?? "";
  if (days <= 0) {
    if (now - then < 20 * 60_000) return "刚才";
    return `今天${part}`;
  }
  if (days === 1) return `昨天${part}`;
  if (days === 2) return `前天${part}`;
  if (days < 7) return `${chineseNumeral(days)}天前`;
  if (days < 14) return "一个多星期前";
  if (days < 28) return `${chineseNumeral(Math.floor(days / 7))}个星期前`;
  if (days < 60) return "上个月";
  if (days < 365) return `${chineseNumeral(Math.floor(days / 30))}个月前`;
  const years = Math.floor(days / 365);
  return years === 1 ? "去年" : `${chineseNumeral(years)}年前`;
}
