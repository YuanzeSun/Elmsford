// Per-day bookkeeping, all in code: weather, the director's happenings, and the daily rules
// (wages and food, health drifting, promises falling due). No LLM here.

import { randomUUID } from "node:crypto";
import { calendar, climate, frictionTable, MONEY_WORRY, MONEY_WORRY_PENCE, openings, weatherWords } from "@elmsford/content";
import {
  calmScore,
  computeGameTime,
  dayNumber,
  direct,
  fromDayNumber,
  dateKey,
  isWet,
  PLAYER_ID,
  rollWeather,
  seededRng,
  zonedToInstant,
  type Weather,
} from "@elmsford/core";
import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { Village } from "../village";
import { addItems, endResident, getCharacters, getCommitments, getResidents, logEvent, resolveCommitments } from "../world/repo";

export type DayRow = typeof t.villageDays.$inferSelect;

const DAY = 86_400_000;
const CALM_WINDOW_DAYS = 3;

export function dateShift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return dateKey(fromDayNumber(dayNumber(y, m, d) + days));
}

/** Local midnight of a village date, as an instant. */
export function startOfDate(village: Village, date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return zonedToInstant(y, m, d, 0, 0, village.timeZone);
}

export function getDay(db: Db, villageId: string, date: string): DayRow | undefined {
  return db.select().from(t.villageDays).where(and(eq(t.villageDays.villageId, villageId), eq(t.villageDays.date, date))).get();
}

function rollFor(db: Db, village: Village, date: string): Weather {
  const yesterday = getDay(db, village.id, dateShift(date, -1))?.weather ?? null;
  const month = Number(date.slice(5, 7));
  return rollWeather(climate[month - 1]!, yesterday, `${village.id}:${date}:weather`, weatherWords);
}

function notableCount(db: Db, villageId: string, from: number, to: number): number {
  const mems = db
    .select({ importance: t.memories.importance })
    .from(t.memories)
    .where(and(eq(t.memories.villageId, villageId), gte(t.memories.at, from), lt(t.memories.at, to)))
    .all()
    .filter((m) => m.importance >= 6).length;
  const events = db
    .select({ type: t.worldEvents.type })
    .from(t.worldEvents)
    .where(and(eq(t.worldEvents.villageId, villageId), gte(t.worldEvents.at, from), lt(t.worldEvents.at, to)))
    .all()
    .filter((e) => ["public", "happening", "conversation", "arrival", "departure"].includes(e.type)).length;
  return mems + events;
}

/**
 * Create the day's record if it doesn't exist: roll the weather and let the director look at
 * how quiet the last few days were. Idempotent.
 */
export function ensureDay(db: Db, village: Village, date: string): DayRow {
  const existing = getDay(db, village.id, date);
  if (existing) return existing;

  let weather = rollFor(db, village, date);
  const dayStart = startOfDate(village, date);
  const residents = getResidents(db, village.id);

  // Calm only means something once the village has been running for a few days.
  const villageAgeDays = (dayStart - village.createdAt) / DAY;
  const calm = villageAgeDays >= CALM_WINDOW_DAYS ? calmScore(notableCount(db, village.id, dayStart - CALM_WINDOW_DAYS * DAY, dayStart), CALM_WINDOW_DAYS, residents.length) : null;

  const happenings: t.DirectorHappening[] = [];
  if (calm !== null) {
    const recentDays = db
      .select()
      .from(t.villageDays)
      .where(and(eq(t.villageDays.villageId, village.id), gte(t.villageDays.date, dateShift(date, -60))))
      .all();
    const recent = recentDays.flatMap((d) =>
      d.happenings.map((h) => ({ id: h.kind, daysAgo: Math.round((dayStart - startOfDate(village, d.date)) / DAY) })),
    );
    const happening = direct({
      seed: `${village.id}:${date}:director`,
      month: Number(date.slice(5, 7)),
      tempC: weather.tempC,
      calm,
      people: residents.map((c) => ({ id: c.id, name: c.shortName, age: c.age, health: c.state.health })),
      recent,
      table: frictionTable,
    });
    if (happening) {
      happenings.push({ kind: happening.defId, text: happening.text, ...(happening.characterId ? { characterId: happening.characterId } : {}) });
      if (happening.effect.weather) weather = { ...weather, sky: happening.effect.weather.sky, text: happening.effect.weather.text };
      applyHappening(db, village, dayStart, happening);
    }
  }

  db.insert(t.villageDays).values({ villageId: village.id, date, weather, calm, happenings }).onConflictDoNothing().run();
  return getDay(db, village.id, date)!;
}

function applyHappening(db: Db, village: Village, at: number, h: ReturnType<typeof direct> & object) {
  const c = h.characterId ? getCharacters(db, village.id).find((x) => x.id === h.characterId) : undefined;
  if (c) {
    const state = { ...c.state };
    if (h.effect.health) state.health = Math.max(1, Math.min(100, state.health + h.effect.health));
    if (h.effect.money) state.money = Math.max(0, state.money + h.effect.money);
    if (h.effect.concern && !state.concerns.includes(h.effect.concern)) state.concerns = [...state.concerns, h.effect.concern].slice(-6);
    db.update(t.characters).set({ state }).where(and(eq(t.characters.villageId, village.id), eq(t.characters.id, c.id))).run();
    if (h.effect.item) addItems(db, village.id, h.effect.item.owner === "target" ? c.id : h.effect.item.owner, h.effect.item.name, h.effect.item.qty);
  } else if (h.effect.item && h.effect.item.owner !== "target") {
    addItems(db, village.id, h.effect.item.owner, h.effect.item.name, h.effect.item.qty);
  }
  const visibleTo = h.visibility === "public" ? ["public"] : c ? [c.id] : [];
  logEvent(db, village.id, at + 6 * 3_600_000, "happening", { text: h.text, kind: h.defId, characterId: h.characterId ?? null }, visibleTo);
}

/**
 * The daily rules, applied once per finished day: wages and food, health drifting toward
 * well or worse, promises past their day, people passing through moving on. Pure code
 * (技术设计 §4.3 layer 2).
 */
export function settleDay(db: Db, village: Village, date: string) {
  const day = ensureDay(db, village, date);
  if (day.settled) return;
  const dayStart = startOfDate(village, date);
  const gt = computeGameTime(dayStart + 12 * 3_600_000, village.timeZone, calendar);
  const rng = seededRng(`${village.id}:${date}:rules`);
  const coldWet = isWet(day.weather) && day.weather.tempC <= 8;

  db.transaction((tx) => {
    for (const c of getResidents(tx as unknown as Db, village.id)) {
      const state = { ...c.state, concerns: [...c.state.concerns] };
      const eco = c.economy;
      const sick = state.health < 40;
      if (eco) {
        const [lo, hi] = gt.liturgical.holyDay ? eco.holyday : eco.workday;
        const earned = sick ? 0 : lo + Math.floor(rng() * (hi - lo + 1));
        state.money = Math.max(0, state.money + earned - eco.spend);
      }
      if (state.money < MONEY_WORRY_PENCE && !state.concerns.includes(MONEY_WORRY)) state.concerns.push(MONEY_WORRY);
      if (state.money >= MONEY_WORRY_PENCE * 3) state.concerns = state.concerns.filter((x) => x !== MONEY_WORRY);

      // Health: the ill mend slowly, the old feel the cold and wet.
      let dh = state.health < 85 ? 3 + Math.floor(rng() * 4) : 0;
      if (coldWet && c.age >= 60) dh -= 3;
      if (sick && c.age >= 70 && rng() < 0.15) dh -= 6;
      state.health = Math.max(0, Math.min(100, state.health + dh));
      if (state.health >= 70) state.concerns = state.concerns.filter((x) => !/咳嗽|发烧|起不来|发冷/.test(x));

      tx.update(t.characters).set({ state }).where(and(eq(t.characters.villageId, village.id), eq(t.characters.id, c.id))).run();
      if (state.health <= 0) endResident(tx as unknown as Db, village.id, c.id, "dead", dayStart + 20 * 3_600_000, `${c.name}去世了。`);
      else if (c.leavesOn && c.leavesOn <= dateShift(date, 1)) {
        // They set off early the next morning.
        const farewell = openings.find((o) => c.id.startsWith(`${o.id}-`))?.farewell ?? "{name}走了。";
        endResident(tx as unknown as Db, village.id, c.id, "gone", dayStart + DAY + 7 * 3_600_000, farewell.replaceAll("{name}", c.shortName));
      }
    }

    // Promises past their day.
    const dayEnd = dayStart + DAY;
    const overdue = getCommitments(tx as unknown as Db, village.id, { status: "open" }).filter((x) => x.due && x.due < dayEnd - DAY);
    for (const x of overdue) {
      resolveCommitments(tx as unknown as Db, village.id, [x.id], "broken", dayEnd);
      if (x.byId === PLAYER_ID) {
        tx.insert(t.memories)
          .values({ id: randomUUID(), villageId: village.id, characterId: x.toId, at: dayEnd, text: `抄写员答应过${x.text}，到了日子也没见动静。`, importance: 5, participants: [PLAYER_ID], factIds: [] })
          .run();
        const rel = tx.select().from(t.relationships).where(and(eq(t.relationships.villageId, village.id), eq(t.relationships.fromId, x.toId), eq(t.relationships.toId, PLAYER_ID))).get();
        if (rel) tx.update(t.relationships).set({ trust: Math.max(-100, rel.trust - 3) }).where(and(eq(t.relationships.villageId, village.id), eq(t.relationships.fromId, x.toId), eq(t.relationships.toId, PLAYER_ID))).run();
      }
    }
    tx.update(t.villageDays).set({ settled: true }).where(and(eq(t.villageDays.villageId, village.id), eq(t.villageDays.date, date))).run();
  });
}
