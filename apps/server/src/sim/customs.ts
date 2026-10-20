// The village's customs as prompt text: what the coming days mean, to everyone and to each person.

import { calendar, customs } from "@elmsford/content";
import { customsAround, type CustomInEffect, type GameTime } from "@elmsford/core";

const WHEN: Record<string, string> = { "-3": "大后天", "-2": "后天", "-1": "明天", "0": "今天", "1": "昨天" };

export function inEffect(gt: GameTime): CustomInEffect[] {
  return customsAround(gt, calendar, customs);
}

function head(x: CustomInEffect): string {
  const when = "feast" in x.custom.when ? `${WHEN[String(x.offset)] ?? ""}是` : "这些天是";
  return "bell" in x.custom.when ? `刚敲过${x.custom.name}` : `${when}${x.custom.name}`;
}

/** For one resident: what the days mean, and what they mean to them. */
export function customsForResident(gt: GameTime, characterId: string): string {
  const lines = inEffect(gt).map((x) => {
    const mine = x.custom.personal?.[characterId];
    return `- ${head(x)}。${x.custom.lore}${mine ? ` 对你来说：${mine}` : ""}`;
  });
  return lines.length ? lines.join("\n") : "- 寻常日子。";
}

/** For planning a day: what's coming, and what it means to each of those here (id → short name). */
export function customsForPlanning(gt: GameTime, here: ReadonlyMap<string, string>): string[] {
  return inEffect(gt)
    .filter((x) => !("bell" in x.custom.when) && x.offset <= 0)
    .map((x) => {
      const personal = Object.entries(x.custom.personal ?? {}).flatMap(([id, t]) => (here.has(id) ? [`${here.get(id)}：${t}`] : []));
      return `${head(x)}。${x.custom.lore}${personal.length ? `（${personal.join("；")}）` : ""}`;
    });
}

/** One short line for background scenes. */
export function customsInBrief(gt: GameTime): string {
  const days = inEffect(gt).filter((x) => !("bell" in x.custom.when) && x.offset <= 0);
  return days.length ? `这几天：${days.map((x) => `${head(x)}`).join("，")}。` : "";
}
