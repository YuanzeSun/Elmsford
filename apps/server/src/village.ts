import { calendar, economy, characters as seedCharacters, relationships as seedRelationships, routines, startingInventory, storyDay } from "@elmsford/content";
import { computeGameTime, zonedToInstant } from "@elmsford/core";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { characters, inventory, relationships, villages } from "./db/schema";

export type Village = typeof villages.$inferSelect;
export type TimeMode = Village["timeMode"];

const PLAYER_START_LOCATION = "player_house";
/** 2 先令 6 便士：搬家剩下的一点钱。 */
const PLAYER_START_MONEY = 30;

export function getVillage(db: Db, id: string): Village | undefined {
  return db.select().from(villages).where(eq(villages.id, id)).get();
}

/** Create the village from the content seeds on first visit; afterwards only the time zone may change. */
export function ensureVillage(db: Db, id: string, timeZone: string, now: number): Village {
  const existing = getVillage(db, id);
  if (existing) {
    if (existing.timeZone !== timeZone) {
      db.update(villages).set({ timeZone }).where(eq(villages.id, id)).run();
      return { ...existing, timeZone };
    }
    return existing;
  }

  db.transaction((tx) => {
    tx.insert(villages)
      .values({ id, timeZone, createdAt: now, playerLocationId: PLAYER_START_LOCATION, playerMoney: PLAYER_START_MONEY })
      .run();
    for (const c of seedCharacters) {
      tx.insert(characters)
        .values({
          villageId: id,
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          age: c.age,
          seed: c.seed,
          state: structuredClone(c.initialState),
          status: "here",
          origin: "seed",
          routine: routines[c.id]!,
          economy: economy[c.id] ?? null,
        })
        .run();
    }
    for (const r of seedRelationships) {
      tx.insert(relationships)
        .values({ villageId: id, fromId: r.from, toId: r.to, trust: r.trust, affection: r.affection, summary: r.summary })
        .run();
    }
    seedInventory(tx as unknown as Db, id);
  });
  return getVillage(db, id)!;
}

/**
 * The player walks in, having chosen how the days go; it can't be changed afterwards. A story
 * village starts its own clock on the morning of the day it was made.
 */
export function startVillage(db: Db, id: string, mode: TimeMode, now: number): Village {
  const v = getVillage(db, id);
  if (!v || v.startedAt) return v!;
  const gt = computeGameTime(now, v.timeZone, calendar);
  const [y, m, d] = gt.date.split("-").map(Number) as [number, number, number];
  const morning = storyDay.segments[0]!.from;
  const at = mode === "story" ? zonedToInstant(y, m, d, Math.floor(morning / 60), morning % 60, v.timeZone) : now;
  db.update(villages)
    .set({ timeMode: mode, startedAt: at, storyAt: mode === "story" ? at : null, lastSeenAt: at, ...(mode === "story" ? { createdAt: Math.min(v.createdAt, at) } : {}) })
    .where(eq(villages.id, id))
    .run();
  return getVillage(db, id)!;
}

function seedInventory(db: Db, villageId: string) {
  for (const [ownerId, items] of Object.entries(startingInventory)) {
    for (const [item, quantity] of Object.entries(items)) {
      db.insert(inventory).values({ villageId, ownerId, item, quantity }).onConflictDoNothing().run();
    }
  }
}
