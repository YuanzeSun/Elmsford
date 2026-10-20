// "这几天" (技术设计 §4.4): what the player sees and hears on coming back. Only things they could
// plausibly know go in: what's at their door, what everyone knows, what people on the road say.

import { randomUUID } from "node:crypto";
import { calendar, loadPrompt, renderPrompt } from "@elmsford/content";
import { chineseNumeral, computeGameTime, PLAYER_ID } from "@elmsford/core";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { describeInventory, getInventory } from "../world/repo";
import { ensureDay } from "./days";

const HOUR = 3_600_000;
/** Away at least this long (game time) and you get a "这几天". */
export const RECAP_AFTER_MS = 8 * HOUR;

export type RecapRow = typeof t.recaps.$inferSelect;

export function awayText(ms: number): string {
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `${chineseNumeral(Math.max(1, hours))}个钟头`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${chineseNumeral(days)}天`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${chineseNumeral(weeks)}个星期`;
  return `${chineseNumeral(Math.round(days / 30))}个月`;
}

export function startRecap(db: Db, village: Village, fromAt: number, toAt: number, kind: RecapRow["kind"] = "away"): RecapRow {
  const id = randomUUID();
  db.insert(t.recaps).values({ id, villageId: village.id, fromAt, toAt, createdAt: toAt, kind, status: "pending" }).run();
  return db.select().from(t.recaps).where(eq(t.recaps.id, id)).get()!;
}

export function pendingRecap(db: Db, villageId: string): RecapRow | undefined {
  return db.select().from(t.recaps).where(and(eq(t.recaps.villageId, villageId), eq(t.recaps.status, "pending"))).get();
}

export function latestUnseenRecap(db: Db, villageId: string): RecapRow | undefined {
  return db
    .select()
    .from(t.recaps)
    .where(and(eq(t.recaps.villageId, villageId), isNull(t.recaps.seenAt)))
    .orderBy(desc(t.recaps.createdAt))
    .get();
}

function knowableItems(db: Db, village: Village, from: number, to: number): string[] {
  const events = db
    .select()
    .from(t.worldEvents)
    .where(and(eq(t.worldEvents.villageId, village.id), gte(t.worldEvents.at, from), lt(t.worldEvents.at, to)))
    .all()
    .filter((e) => e.visibleTo.includes("public") || e.visibleTo.includes(PLAYER_ID));

  const items: string[] = [];
  for (const e of events) {
    const p = e.payload as { text?: string; from?: string };
    if (e.type === "visit" && p.text) items.push(`门口/留话：${p.text}`);
    else if (e.type === "letter_arrived") items.push(`商贩捎来一封回信（${p.from ?? "远方"}寄来的），在你的书桌上。`);
    else if (["public", "happening", "death", "arrival", "departure"].includes(e.type) && p.text) items.push(`村里人都知道：${p.text}`);
  }
  const atDoor = getInventory(db, village.id, "loc:player_house");
  if (atDoor.size) items.push(`你门口现在放着：${describeInventory(atDoor)}`);
  const today = ensureDay(db, village, computeGameTime(to, village.timeZone, calendar).date);
  items.push(`今天的天气：${today.weather.text}`);
  return items;
}

export async function buildRecap(db: Db, gateway: LlmGateway, village: Village, recap: RecapRow): Promise<void> {
  const items = knowableItems(db, village, recap.fromAt, recap.toAt);
  const rested = recap.kind === "rested";
  const away = rested ? "他没出门，在屋里歇了一天" : awayText(recap.toAt - recap.fromAt);
  const gone = rested ? "你歇了一天" : `你离开了${away}`;
  let text: string;
  if (items.length <= 1) {
    text = `${gone}。村子照常过着，没听说出什么事。${items[0]?.replace("今天的天气：", "") ?? ""}`;
  } else {
    try {
      const r = await gateway.call({
        tier: "cheap",
        purpose: "sim.recap",
        villageId: village.id,
        background: true,
        system: [{ text: loadPrompt("world"), cache: true }],
        messages: [{ role: "user", content: renderPrompt("recap", { away, items: items.map((i) => `- ${i}`).join("\n") }) }],
        maxTokens: 3000,
        effort: "low",
        cacheKey: `elmsford.recap.${village.id}`,
      });
      text = r.text.trim();
    } catch {
      text = [`${gone}。`, ...items.map((i) => i.replace(/^[^：]+：/, ""))].join("\n");
    }
  }
  db.update(t.recaps).set({ status: "ready", text }).where(eq(t.recaps.id, recap.id)).run();
}
