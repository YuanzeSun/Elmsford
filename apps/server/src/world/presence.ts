// Where everyone is right now (技术设计 §4.3, layer 2): pure code over the day's plan.
// A planned day comes from the planner (M2); without one, the resident's routine is used.

import { calendar } from "@elmsford/content";
import { blockAt, computeGameTime, nextBlock, routineForDay, type GameTime, type PlanBlock } from "@elmsford/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { getResidents, type CharacterRow } from "./repo";

export interface Presence {
  character: CharacterRow;
  block: PlanBlock;
  next?: PlanBlock;
  asleep: boolean;
  /** "plan" when the planner wrote today, "routine" otherwise. */
  source: "plan" | "routine";
}

/** Someone who just walked off from a conversation stays out of reach a while. */
export function markBusy(db: Db, villageId: string, characterId: string, until: number) {
  const c = db.select().from(t.characters).where(and(eq(t.characters.villageId, villageId), eq(t.characters.id, characterId))).get();
  if (!c) return;
  db.update(t.characters)
    .set({ state: { ...c.state, busyUntil: until } })
    .where(and(eq(t.characters.villageId, villageId), eq(t.characters.id, characterId)))
    .run();
}

export const isBusy = (character: CharacterRow, now: number) => (character.state.busyUntil ?? 0) > now;

export function dayBlocks(db: Db, villageId: string, character: CharacterRow, gt: GameTime): { blocks: PlanBlock[]; source: Presence["source"] } {
  const planned = db
    .select()
    .from(t.dayPlans)
    .where(and(eq(t.dayPlans.villageId, villageId), eq(t.dayPlans.characterId, character.id), eq(t.dayPlans.date, gt.date)))
    .get();
  if (planned && planned.blocks.length) return { blocks: planned.blocks, source: "plan" };
  return { blocks: routineForDay(character.routine, gt, { locationId: character.seed.homeId, activity: "在家" }), source: "routine" };
}

export function presenceOf(db: Db, villageId: string, character: CharacterRow, gt: GameTime): Presence {
  const { blocks, source } = dayBlocks(db, villageId, character, gt);
  const block = blockAt(blocks, gt.minuteOfDay) ?? { from: "00:00", to: "24:00", locationId: character.seed.homeId, activity: "在家" };
  const next = nextBlock(blocks, gt.minuteOfDay);
  const sick = character.state.health < 25;
  const effective = sick ? { ...block, locationId: character.seed.homeId, activity: "病倒了，躺在床上" } : block;
  return {
    character,
    block: effective,
    ...(next && !sick ? { next } : {}),
    asleep: Boolean(block.asleep),
    source,
  };
}

export function everyoneNow(db: Db, villageId: string, now: number, timeZone: string): Presence[] {
  const gt = computeGameTime(now, timeZone, calendar);
  return getResidents(db, villageId).map((c) => presenceOf(db, villageId, c, gt));
}

/** Write each resident's current location and activity into their state, so the world inspector and planners see it. */
export function syncPresence(db: Db, villageId: string, now: number, timeZone: string): Presence[] {
  const all = everyoneNow(db, villageId, now, timeZone);
  for (const p of all) {
    const s = p.character.state;
    if (s.locationId === p.block.locationId && s.activity === p.block.activity) continue;
    db.update(t.characters)
      .set({ state: { ...s, locationId: p.block.locationId, activity: p.block.activity } })
      .where(and(eq(t.characters.villageId, villageId), eq(t.characters.id, p.character.id)))
      .run();
  }
  return all;
}
