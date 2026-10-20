// Reads world state for prompts and validation, and applies validated deltas. Also where people
// join and leave the village. Changes from the model reach the world only through here.

import { randomUUID } from "node:crypto";
import { customs, locations } from "@elmsford/content";
import {
  clampStat,
  PLAYER_ID,
  relKey,
  validateDelta,
  type Newcomer,
  type Routine,
  type ValidationContext,
  type ValidationLimits,
  type WorldDelta,
} from "@elmsford/core";
import type { DailyEconomy } from "@elmsford/content";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";

export type CharacterRow = typeof t.characters.$inferSelect;
export type MemoryRow = typeof t.memories.$inferSelect;
export type FactRow = typeof t.facts.$inferSelect & { belief: number; source: string };
export type CommitmentRow = typeof t.commitments.$inferSelect;

export const LOCATION_IDS: ReadonlySet<string> = new Set(locations.map((l) => l.id));
const LORE_NAMES: ReadonlyMap<string, string> = new Map(customs.map((c) => [c.key, c.name]));
export const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

/** Everyone who has lived here, the gone and the dead included. */
export function getCharacters(db: Db, villageId: string): CharacterRow[] {
  return db.select().from(t.characters).where(eq(t.characters.villageId, villageId)).all();
}

/** Those in the village now: the only ones who are simulated. */
export function getResidents(db: Db, villageId: string): CharacterRow[] {
  return db.select().from(t.characters).where(and(eq(t.characters.villageId, villageId), eq(t.characters.status, "here"))).all();
}

export function getCharacter(db: Db, villageId: string, id: string): CharacterRow | undefined {
  return db
    .select()
    .from(t.characters)
    .where(and(eq(t.characters.villageId, villageId), eq(t.characters.id, id)))
    .get();
}

export function getRelationship(db: Db, villageId: string, from: string, to: string) {
  return db
    .select()
    .from(t.relationships)
    .where(and(eq(t.relationships.villageId, villageId), eq(t.relationships.fromId, from), eq(t.relationships.toId, to)))
    .get();
}

export function getMemories(db: Db, villageId: string, characterId: string, limit = 400): MemoryRow[] {
  return db
    .select()
    .from(t.memories)
    .where(and(eq(t.memories.villageId, villageId), eq(t.memories.characterId, characterId)))
    .orderBy(desc(t.memories.at))
    .limit(limit)
    .all();
}

export function getKnownFacts(db: Db, villageId: string, characterId: string): FactRow[] {
  return db
    .select({
      id: t.facts.id,
      villageId: t.facts.villageId,
      text: t.facts.text,
      at: t.facts.at,
      belief: t.factKnowledge.belief,
      source: t.factKnowledge.source,
    })
    .from(t.factKnowledge)
    .innerJoin(t.facts, eq(t.facts.id, t.factKnowledge.factId))
    .where(and(eq(t.facts.villageId, villageId), eq(t.factKnowledge.characterId, characterId)))
    .orderBy(desc(t.facts.at))
    .all();
}

export function getCommitments(db: Db, villageId: string, opts: { between?: [string, string]; status?: CommitmentRow["status"] } = {}) {
  const rows = db.select().from(t.commitments).where(eq(t.commitments.villageId, villageId)).all();
  return rows.filter(
    (c) =>
      (!opts.status || c.status === opts.status) &&
      (!opts.between ||
        (c.byId === opts.between[0] && c.toId === opts.between[1]) ||
        (c.byId === opts.between[1] && c.toId === opts.between[0])),
  );
}

export function getInventory(db: Db, villageId: string, ownerId: string): Map<string, number> {
  const rows = db
    .select()
    .from(t.inventory)
    .where(and(eq(t.inventory.villageId, villageId), eq(t.inventory.ownerId, ownerId)))
    .all();
  return new Map(rows.filter((r) => r.quantity > 0).map((r) => [r.item, r.quantity]));
}

export function addItems(db: Db, villageId: string, ownerId: string, item: string, delta: number) {
  const current = getInventory(db, villageId, ownerId).get(item) ?? 0;
  const next = Math.max(0, current + delta);
  db.insert(t.inventory)
    .values({ villageId, ownerId, item, quantity: next })
    .onConflictDoUpdate({ target: [t.inventory.villageId, t.inventory.ownerId, t.inventory.item], set: { quantity: next } })
    .run();
}

export function describeInventory(items: Map<string, number>): string {
  const parts = [...items].filter(([, n]) => n > 0).map(([item, n]) => (n === 1 ? item : `${item}×${n}`));
  return parts.length ? parts.join("、") : "没什么值钱的";
}

export function formatPence(pence: number): string {
  if (pence <= 0) return "一个子儿也没有";
  const shillings = Math.floor(pence / 12);
  const rest = pence % 12;
  if (!shillings) return `${rest} 便士`;
  return rest ? `${shillings} 先令 ${rest} 便士` : `${shillings} 先令`;
}

export function getPlayerMoney(db: Db, villageId: string): number {
  return db.select({ m: t.villages.playerMoney }).from(t.villages).where(eq(t.villages.id, villageId)).get()?.m ?? 0;
}

export function logEvent(db: Db, villageId: string, at: number, type: string, payload: unknown, visibleTo: string[]) {
  db.insert(t.worldEvents).values({ id: randomUUID(), villageId, at, type, payload, visibleTo }).run();
}

// ---------------------------------------------------------------- validation + apply

export interface ApplyOptions {
  villageId: string;
  now: number;
  /** Label for the rejection log, e.g. "conversation:<id>". */
  source: string;
  participants: string[];
  witnesses?: string[];
  utterances: Record<string, string>;
  limits: ValidationLimits;
  /** The place things happened, for events. */
  locationId?: string;
}

export function buildValidationContext(db: Db, o: ApplyOptions): ValidationContext {
  const chars = getCharacters(db, o.villageId);
  const everyone = [...new Set([...o.participants, ...(o.witnesses ?? [])])];
  const rels = db.select().from(t.relationships).where(eq(t.relationships.villageId, o.villageId)).all();
  const known = new Map<string, Set<string>>();
  for (const id of everyone) known.set(id, new Set(getKnownFacts(db, o.villageId, id).map((f) => f.id)));
  const inventory = new Map<string, Map<string, number>>();
  for (const id of o.participants) inventory.set(id, getInventory(db, o.villageId, id));

  return {
    now: o.now,
    participants: o.participants,
    witnesses: o.witnesses ?? [],
    characters: new Map(chars.map((c) => [c.id, { here: c.status === "here", concerns: c.state.concerns, money: c.state.money }])),
    playerMoney: getPlayerMoney(db, o.villageId),
    relationships: new Map(rels.map((r) => [relKey(r.fromId, r.toId), { trust: r.trust, affection: r.affection }])),
    knownFacts: known,
    utterances: o.utterances,
    inventory,
    locationIds: LOCATION_IDS,
    lore: LORE_NAMES,
    limits: o.limits,
  };
}

export interface ApplyResult {
  applied: WorldDelta;
  rejectedCount: number;
  memoryIds: string[];
  factIds: string[];
}

/** Validate a proposed delta, write the clean part, and log what was refused. */
export function validateAndApply(db: Db, proposed: WorldDelta, o: ApplyOptions): ApplyResult {
  const { delta, rejected } = validateDelta(proposed, buildValidationContext(db, o));
  const memoryIds: string[] = [];
  const factIds: string[] = [];

  db.transaction((tx) => {
    const v = o.villageId;

    for (const r of rejected) {
      tx.insert(t.rejections).values({ id: randomUUID(), villageId: v, at: o.now, source: o.source, field: r.field, item: r.item, reason: r.reason }).run();
    }

    // Facts first, so memories can point at them.
    const newFactIdByText = new Map<string, string>();
    for (const f of delta.facts) {
      let factId = f.factId;
      if (!factId) {
        factId = newFactIdByText.get(f.text);
        if (!factId) {
          factId = randomUUID();
          newFactIdByText.set(f.text, factId);
          tx.insert(t.facts).values({ id: factId, villageId: v, text: f.text, at: o.now }).run();
        }
      }
      tx.insert(t.factKnowledge)
        .values({ factId, characterId: f.characterId, belief: f.belief, source: f.source })
        .onConflictDoUpdate({ target: [t.factKnowledge.factId, t.factKnowledge.characterId], set: { belief: f.belief, source: f.source } })
        .run();
      factIds.push(factId);
    }

    for (const m of delta.memories) {
      const id = randomUUID();
      memoryIds.push(id);
      const linked = delta.facts.filter((f) => f.characterId === m.characterId).map((f) => (f.factId ?? newFactIdByText.get(f.text))!);
      tx.insert(t.memories)
        .values({ id, villageId: v, characterId: m.characterId, at: o.now, text: m.text, importance: m.importance, participants: m.participants, factIds: linked })
        .run();
    }

    for (const c of delta.commitments) {
      tx.insert(t.commitments)
        .values({ id: randomUUID(), villageId: v, byId: c.by, toId: c.to, text: c.text, due: c.due ?? null, status: "open", createdAt: o.now })
        .run();
    }

    for (const r of delta.relationships) {
      const cur = tx
        .select()
        .from(t.relationships)
        .where(and(eq(t.relationships.villageId, v), eq(t.relationships.fromId, r.from), eq(t.relationships.toId, r.to)))
        .get();
      const trust = clampStat((cur?.trust ?? 0) + r.trustDelta);
      const affection = clampStat((cur?.affection ?? 0) + r.affectionDelta);
      const summary = r.newSummary ?? cur?.summary ?? "";
      tx.insert(t.relationships)
        .values({ villageId: v, fromId: r.from, toId: r.to, trust, affection, summary })
        .onConflictDoUpdate({ target: [t.relationships.villageId, t.relationships.fromId, t.relationships.toId], set: { trust, affection, summary } })
        .run();
    }

    for (const c of delta.concerns) {
      const ch = tx.select().from(t.characters).where(and(eq(t.characters.villageId, v), eq(t.characters.id, c.characterId))).get();
      if (!ch) continue;
      const concerns = [...ch.state.concerns.filter((x) => !c.remove.includes(x)), ...c.add].slice(-o.limits.maxConcerns);
      tx.update(t.characters).set({ state: { ...ch.state, concerns } }).where(and(eq(t.characters.villageId, v), eq(t.characters.id, c.characterId))).run();
    }

    for (const tr of delta.transfers) {
      if (tr.pence !== undefined) {
        const move = (id: string, d: number) => {
          if (id === PLAYER_ID) {
            const cur = tx.select().from(t.villages).where(eq(t.villages.id, v)).get()!;
            tx.update(t.villages).set({ playerMoney: cur.playerMoney + d }).where(eq(t.villages.id, v)).run();
          } else {
            const ch = tx.select().from(t.characters).where(and(eq(t.characters.villageId, v), eq(t.characters.id, id))).get();
            if (ch) tx.update(t.characters).set({ state: { ...ch.state, money: ch.state.money + d } }).where(and(eq(t.characters.villageId, v), eq(t.characters.id, id))).run();
          }
        };
        move(tr.from, -tr.pence);
        move(tr.to, tr.pence);
      } else if (tr.item) {
        addItems(tx as unknown as Db, v, tr.from, tr.item, -(tr.quantity ?? 1));
        addItems(tx as unknown as Db, v, tr.to, tr.item, tr.quantity ?? 1);
      }
      tx.insert(t.worldEvents)
        .values({ id: randomUUID(), villageId: v, at: o.now, type: "transfer", payload: tr, visibleTo: [tr.from, tr.to].filter((x) => !x.startsWith("loc:")) })
        .run();
    }

    for (const l of delta.lore) {
      const same = tx
        .select()
        .from(t.lore)
        .where(and(eq(t.lore.villageId, v), eq(t.lore.key, l.key), eq(t.lore.text, l.text)))
        .get();
      if (!same) tx.insert(t.lore).values({ id: randomUUID(), villageId: v, key: l.key, text: l.text, source: l.source, at: o.now }).run();
    }

    for (const n of delta.playerNotes) {
      tx.insert(t.notebook).values({ id: randomUUID(), villageId: v, characterId: n.characterId, at: o.now, text: n.text, byPlayer: false }).run();
    }

    for (const e of delta.events) {
      tx.insert(t.worldEvents)
        .values({ id: randomUUID(), villageId: v, at: o.now, type: e.type, payload: { text: e.text, locationId: e.locationId ?? o.locationId ?? null }, visibleTo: e.visibleTo })
        .run();
    }
  });

  return { applied: delta, rejectedCount: rejected.length, memoryIds, factIds };
}

export function markRecalled(db: Db, ids: string[], at: number) {
  if (ids.length) db.update(t.memories).set({ lastRecalledAt: at }).where(inArray(t.memories.id, ids)).run();
}

export function resolveCommitments(db: Db, villageId: string, ids: string[], status: "kept" | "broken" | "released", at: number) {
  if (!ids.length) return;
  db.update(t.commitments)
    .set({ status, resolvedAt: at })
    .where(and(eq(t.commitments.villageId, villageId), inArray(t.commitments.id, ids), eq(t.commitments.status, "open")))
    .run();
}

// ---------------------------------------------------------------- joining and leaving

export interface Joining {
  id: string;
  origin: "folk" | "arrival";
  /** Who they are, already through validateNewcomer. */
  person: Newcomer;
  homeId: string;
  routine: Routine;
  economy: DailyEconomy;
  health: number;
  money: number;
  items: Record<string, number>;
  at: number;
  leavesOn?: string | null;
  /** How residents see them, and they see residents, where the draft says nothing. */
  seenAs: string;
  seesOthersAs: string;
  /** How they see the scribe. */
  seesPlayerAs: string;
  /** What the village hears, for an arrival. */
  announce?: string;
}

/** Someone joins the residents: their row, how they and the others see each other, what they carry. */
export function addResident(db: Db, villageId: string, j: Joining) {
  const p = j.person;
  db.transaction((tx) => {
    const others = getResidents(tx as unknown as Db, villageId);
    tx.insert(t.characters)
      .values({
        villageId,
        id: j.id,
        name: p.name,
        shortName: p.shortName,
        age: p.age,
        seed: {
          occupation: p.occupation,
          personality: p.personality,
          cares: p.cares,
          flaws: p.flaws,
          wants: p.wants,
          situation: p.situation,
          speech: p.speech,
          household: p.household,
          homeId: j.homeId,
        },
        state: { health: j.health, mood: p.mood, money: j.money, locationId: j.homeId, activity: "在家", concerns: p.concerns },
        status: "here",
        origin: j.origin,
        routine: j.routine,
        economy: j.economy,
        joinedAt: j.at,
        leavesOn: j.leavesOn ?? null,
      })
      .run();

    const rel = (fromId: string, toId: string, v: { trust: number; affection: number; summary: string }) =>
      tx.insert(t.relationships)
        .values({ villageId, fromId, toId, trust: v.trust, affection: v.affection, summary: v.summary })
        .onConflictDoUpdate({ target: [t.relationships.villageId, t.relationships.fromId, t.relationships.toId], set: { trust: v.trust, affection: v.affection, summary: v.summary } })
        .run();
    for (const o of others) {
      rel(o.id, j.id, p.seenBy.find((v) => v.personId === o.id) ?? { trust: 0, affection: 0, summary: j.seenAs });
      rel(j.id, o.id, p.views.find((v) => v.personId === o.id) ?? { trust: 0, affection: 0, summary: j.seesOthersAs });
    }
    rel(j.id, PLAYER_ID, { trust: 0, affection: 0, summary: j.seesPlayerAs });

    for (const m of p.memories) {
      tx.insert(t.memories).values({ id: randomUUID(), villageId, characterId: j.id, at: j.at, text: m.text, importance: m.importance, participants: [], factIds: [] }).run();
    }
    for (const [item, qty] of Object.entries(j.items)) addItems(tx as unknown as Db, villageId, j.id, item, qty);

    if (j.announce) {
      // Everyone hears of it the same day, the way news goes round a village.
      const factId = randomUUID();
      tx.insert(t.facts).values({ id: factId, villageId, text: j.announce, at: j.at }).run();
      for (const id of [...others.map((o) => o.id), j.id]) tx.insert(t.factKnowledge).values({ factId, characterId: id, belief: 1, source: "seen" }).run();
      logEvent(tx as unknown as Db, villageId, j.at, "arrival", { characterId: j.id, text: j.announce }, ["public"]);
    }
  });
}

/** Someone leaves the village for good, or dies. They're no longer simulated; what people remember stays. */
export function endResident(db: Db, villageId: string, characterId: string, how: "gone" | "dead", at: number, text: string) {
  db.transaction((tx) => {
    tx.update(t.characters).set({ status: how, endedAt: at }).where(and(eq(t.characters.villageId, villageId), eq(t.characters.id, characterId))).run();
    const factId = randomUUID();
    tx.insert(t.facts).values({ id: factId, villageId, text, at }).run();
    for (const o of getResidents(tx as unknown as Db, villageId)) tx.insert(t.factKnowledge).values({ factId, characterId: o.id, belief: 1, source: "seen" }).run();
    logEvent(tx as unknown as Db, villageId, at, how === "dead" ? "death" : "departure", { characterId, text }, ["public"]);
  });
}
