// What the player has been told about the village's customs — the notebook's 日子, and the
// names in the headline that the player can now look into.

import { calendar, customs } from "@elmsford/content";
import type { GameTime } from "@elmsford/core";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { getCharacters } from "./repo";

export interface HeardDay {
  key: string;
  name: string;
  lines: { text: string; from: string; at: number }[];
}

const order = new Map(customs.map((c, i) => [c.key, i]));

export function heardDays(db: Db, villageId: string): HeardDay[] {
  const rows = db.select().from(t.lore).where(eq(t.lore.villageId, villageId)).orderBy(asc(t.lore.at)).all();
  const names = new Map(getCharacters(db, villageId).map((c) => [c.id, c.shortName]));
  const byKey = new Map<string, HeardDay>();
  for (const r of rows) {
    const custom = customs.find((c) => c.key === r.key);
    if (!custom) continue;
    const day = byKey.get(r.key) ?? { key: r.key, name: custom.name, lines: [] };
    day.lines.push({ text: r.text, from: names.get(r.source) ?? r.source, at: r.at });
    byKey.set(r.key, day);
  }
  return [...byKey.values()].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}

/**
 * Names in today's headline the player has been told about, with what they heard. The headline
 * names a feast (today's, tomorrow's, or the one being counted from) and a bell.
 */
export function heardInHeadline(db: Db, villageId: string, gt: GameTime): { match: string; lines: HeardDay["lines"] }[] {
  const heard = new Map(heardDays(db, villageId).map((d) => [d.key, d]));
  const feast = gt.liturgical.feasts[0] ?? gt.liturgical.eveOf ?? gt.liturgical.anchor?.feast;
  const candidates: { key: string; match: string }[] = [];
  if (feast) {
    const custom = customs.find((c) => "feast" in c.when && c.when.feast === feast.id);
    if (custom) candidates.push({ key: custom.key, match: feast.name });
  }
  for (const bell of [gt.bells.last.id, gt.bells.next.id]) candidates.push({ key: `bell:${bell}`, match: calendar.bellNames[bell] });
  return candidates.flatMap((c) => {
    const day = heard.get(c.key);
    return day ? [{ match: c.match, lines: day.lines }] : [];
  });
}
