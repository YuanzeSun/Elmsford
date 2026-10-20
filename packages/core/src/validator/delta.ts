// core/validator (技术设计 §4.8): every change an LLM proposes passes through here before it
// can touch the database. Bad items are dropped and reported, never retried or "fixed up".
//
// The validator is pure: it gets a snapshot of the relevant world state and returns the clean
// delta plus a list of rejections. Applying the clean delta is the caller's job.

import { bigrams } from "../memory/retrieval";
import { PLAYER_ID } from "../world/types";

export interface DeltaMemory {
  characterId: string;
  text: string;
  importance: number;
  participants: string[];
}

export interface DeltaFact {
  /** Who now knows (or believes) it. */
  characterId: string;
  text: string;
  belief: number;
  /** "player", the id of the character who told them, or "seen" for something witnessed. */
  source: string;
  /** Set when an existing fact is being passed on rather than a new one learned. */
  factId?: string;
}

export interface DeltaCommitment {
  by: string;
  to: string;
  text: string;
  due?: number;
}

export interface DeltaRelationship {
  from: string;
  to: string;
  trustDelta: number;
  affectionDelta: number;
  newSummary?: string;
}

export interface DeltaConcerns {
  characterId: string;
  add: string[];
  remove: string[];
}

export interface DeltaTransfer {
  from: string;
  to: string;
  /** Either an item… */
  item?: string;
  quantity?: number;
  /** …or money, in pennies. */
  pence?: number;
}

/** A custom a resident told the player about, in their words — for the notebook. */
export interface DeltaLore {
  key: string;
  text: string;
  /** The resident who said it. */
  source: string;
}

export interface DeltaEvent {
  type: string;
  text: string;
  /** Character ids, "player", or "public". */
  visibleTo: string[];
  locationId?: string;
}

export interface WorldDelta {
  memories: DeltaMemory[];
  facts: DeltaFact[];
  commitments: DeltaCommitment[];
  relationships: DeltaRelationship[];
  concerns: DeltaConcerns[];
  transfers: DeltaTransfer[];
  /** Lines for the player's notebook, about a person. */
  playerNotes: { characterId: string; text: string }[];
  lore: DeltaLore[];
  events: DeltaEvent[];
}

export const emptyDelta = (): WorldDelta => ({
  memories: [],
  facts: [],
  commitments: [],
  relationships: [],
  concerns: [],
  transfers: [],
  playerNotes: [],
  lore: [],
  events: [],
});

export interface Rejection {
  field: keyof WorldDelta;
  item: unknown;
  reason: string;
}

export interface ValidationLimits {
  maxMemories: number;
  maxFacts: number;
  maxCommitments: number;
  /** Per relationship per change (技术设计: 一次对话里信任度最多变化 ±10). */
  maxTrustDelta: number;
  maxAffectionDelta: number;
  maxConcerns: number;
  maxCommitmentDays: number;
}

export const CONVERSATION_LIMITS: ValidationLimits = {
  maxMemories: 4,
  maxFacts: 6,
  maxCommitments: 3,
  maxTrustDelta: 10,
  maxAffectionDelta: 10,
  maxConcerns: 6,
  maxCommitmentDays: 90,
};

export const INTERACTION_LIMITS: ValidationLimits = { ...CONVERSATION_LIMITS, maxTrustDelta: 6, maxAffectionDelta: 6 };

export interface ValidationContext {
  now: number;
  /** Who took part; only they may gain memories, make promises or change their views here. */
  participants: string[];
  /** Everyone else who could witness something (e.g. people in the same place). */
  witnesses?: string[];
  /** Everyone who ever lived here; `here` is false once they left or died. */
  characters: ReadonlyMap<string, { here: boolean; concerns: string[]; money: number }>;
  playerMoney: number;
  relationships: ReadonlyMap<string, { trust: number; affection: number }>;
  /** Fact ids each character already knows. */
  knownFacts: ReadonlyMap<string, ReadonlySet<string>>;
  /** What each source actually said, to check that a "learned" fact is grounded in it. */
  utterances: Readonly<Record<string, string>>;
  /** Item counts by owner id. */
  inventory: ReadonlyMap<string, ReadonlyMap<string, number>>;
  locationIds: ReadonlySet<string>;
  /** Customs a resident can talk about, by key, with their names. */
  lore?: ReadonlyMap<string, string>;
  limits: ValidationLimits;
}

export const relKey = (from: string, to: string) => `${from}→${to}`;

const MIN_GROUNDING_BIGRAMS = 2;

/** Shares enough wording with what was said. `ignore` (e.g. a name) doesn't count as evidence. */
function grounded(text: string, said: string | undefined, ignore = ""): boolean {
  if (!said) return false;
  const saidGrams = bigrams(said);
  const skip = bigrams(ignore);
  let shared = 0;
  for (const g of bigrams(text)) if (!skip.has(g) && saidGrams.has(g) && ++shared >= MIN_GROUNDING_BIGRAMS) return true;
  return false;
}

const isPerson = (ctx: ValidationContext, id: string) => id === PLAYER_ID || ctx.characters.get(id)?.here === true;
const textOk = (s: unknown, min: number, max: number): s is string => typeof s === "string" && s.trim().length >= min && s.length <= max;

export function validateDelta(proposed: WorldDelta, ctx: ValidationContext): { delta: WorldDelta; rejected: Rejection[] } {
  const delta = emptyDelta();
  const rejected: Rejection[] = [];
  const reject = (field: keyof WorldDelta, item: unknown, reason: string) => rejected.push({ field, item, reason });
  const participants = new Set(ctx.participants);
  const present = new Set([...ctx.participants, ...(ctx.witnesses ?? [])]);
  const { limits } = ctx;

  for (const m of proposed.memories) {
    if (delta.memories.length >= limits.maxMemories) reject("memories", m, "too many memories in one change");
    else if (!participants.has(m.characterId) || m.characterId === PLAYER_ID) reject("memories", m, "only a participating resident can remember this");
    else if (!textOk(m.text, 4, 240)) reject("memories", m, "text length");
    else if (!Number.isInteger(m.importance) || m.importance < 1 || m.importance > 10) reject("memories", m, "importance must be 1–10");
    else delta.memories.push({ ...m, text: m.text.trim(), participants: m.participants.filter((p) => isPerson(ctx, p)) });
  }

  for (const f of proposed.facts) {
    const knows = ctx.knownFacts.get(f.characterId);
    if (delta.facts.length >= limits.maxFacts) reject("facts", f, "too many facts in one change");
    else if (!present.has(f.characterId) || f.characterId === PLAYER_ID) reject("facts", f, "only someone present can learn this");
    else if (!textOk(f.text, 4, 240)) reject("facts", f, "text length");
    else if (!(f.belief >= 0 && f.belief <= 1)) reject("facts", f, "belief must be 0–1");
    else if (f.factId) {
      // Passing on a known fact: the teller must know it, and must have been here.
      const tellerKnows = ctx.knownFacts.get(f.source);
      if (!participants.has(f.source) || !tellerKnows?.has(f.factId)) reject("facts", f, "the teller doesn't know this fact");
      else if (knows?.has(f.factId)) reject("facts", f, "already known");
      else delta.facts.push(f);
    } else if (f.source === "seen") {
      if (!present.has(f.characterId)) reject("facts", f, "can't have seen it");
      else delta.facts.push(f);
    } else if (!participants.has(f.source)) reject("facts", f, "source wasn't part of this");
    else if (!grounded(f.text, ctx.utterances[f.source])) reject("facts", f, "not grounded in what the source said");
    else delta.facts.push(f);
  }

  for (const c of proposed.commitments) {
    if (delta.commitments.length >= limits.maxCommitments) reject("commitments", c, "too many commitments");
    else if (!participants.has(c.by) || !participants.has(c.to) || c.by === c.to) reject("commitments", c, "both sides must take part");
    else if (!textOk(c.text, 2, 160)) reject("commitments", c, "text length");
    else if (c.due !== undefined && (c.due < ctx.now || c.due > ctx.now + limits.maxCommitmentDays * 86_400_000))
      reject("commitments", c, "due date out of range");
    else delta.commitments.push(c);
  }

  const seenRel = new Set<string>();
  for (const r of proposed.relationships) {
    const key = relKey(r.from, r.to);
    if (seenRel.has(key)) reject("relationships", r, "duplicate");
    else if (!participants.has(r.from) || r.from === PLAYER_ID || !participants.has(r.to) || r.from === r.to)
      reject("relationships", r, "only a participating resident's view of another participant may change");
    else if (!Number.isInteger(r.trustDelta) || Math.abs(r.trustDelta) > limits.maxTrustDelta)
      reject("relationships", r, `trust may change by at most ±${limits.maxTrustDelta}`);
    else if (!Number.isInteger(r.affectionDelta) || Math.abs(r.affectionDelta) > limits.maxAffectionDelta)
      reject("relationships", r, `affection may change by at most ±${limits.maxAffectionDelta}`);
    else if (r.newSummary !== undefined && !textOk(r.newSummary, 2, 60)) reject("relationships", r, "summary length");
    else {
      seenRel.add(key);
      delta.relationships.push(r);
    }
  }

  for (const c of proposed.concerns) {
    const ch = ctx.characters.get(c.characterId);
    if (!ch || !participants.has(c.characterId)) {
      reject("concerns", c, "unknown or absent character");
      continue;
    }
    const add = c.add.filter((s) => {
      const ok = textOk(s, 2, 50) && !ch.concerns.includes(s.trim());
      if (!ok) reject("concerns", s, "bad or duplicate concern");
      return ok;
    });
    const remove = c.remove.filter((s) => {
      const ok = ch.concerns.includes(s);
      if (!ok) reject("concerns", s, "no such concern to remove");
      return ok;
    });
    if (add.length || remove.length) delta.concerns.push({ characterId: c.characterId, add: add.slice(0, 2).map((s) => s.trim()), remove });
  }

  // Track balances as transfers are accepted, so two gifts can't spend the same apple.
  const stock = new Map<string, Map<string, number>>();
  const itemsOf = (owner: string) => {
    let s = stock.get(owner);
    if (!s) {
      s = new Map(ctx.inventory.get(owner) ?? []);
      stock.set(owner, s);
    }
    return s;
  };
  const money = new Map<string, number>([[PLAYER_ID, ctx.playerMoney], ...[...ctx.characters].map(([id, c]) => [id, c.money] as const)]);
  for (const t of proposed.transfers) {
    const toLocation = t.to.startsWith("loc:") && ctx.locationIds.has(t.to.slice(4));
    if (!participants.has(t.from) || (!participants.has(t.to) && !toLocation)) reject("transfers", t, "both sides must be here");
    else if (t.pence !== undefined) {
      if (!Number.isInteger(t.pence) || t.pence <= 0) reject("transfers", t, "pence must be a positive integer");
      else if ((money.get(t.from) ?? 0) < t.pence) reject("transfers", t, "not enough money");
      else {
        money.set(t.from, (money.get(t.from) ?? 0) - t.pence);
        money.set(t.to, (money.get(t.to) ?? 0) + t.pence);
        delta.transfers.push(t);
      }
    } else if (t.item) {
      const qty = t.quantity ?? 1;
      const have = itemsOf(t.from).get(t.item) ?? 0;
      if (!Number.isInteger(qty) || qty <= 0) reject("transfers", t, "quantity must be a positive integer");
      else if (have < qty) reject("transfers", t, "doesn't have it");
      else {
        itemsOf(t.from).set(t.item, have - qty);
        delta.transfers.push({ ...t, quantity: qty });
      }
    } else reject("transfers", t, "nothing to transfer");
  }

  for (const n of proposed.playerNotes) {
    if (!ctx.characters.has(n.characterId) || !textOk(n.text, 2, 120)) reject("playerNotes", n, "bad note");
    else if (delta.playerNotes.length >= 3) reject("playerNotes", n, "too many notes");
    else delta.playerNotes.push(n);
  }

  for (const l of proposed.lore) {
    if (delta.lore.length >= 2) reject("lore", l, "too many");
    else if (!ctx.lore?.has(l.key)) reject("lore", l, "unknown custom");
    else if (l.source === PLAYER_ID || !participants.has(l.source)) reject("lore", l, "only a resident who was there can have said it");
    else if (!textOk(l.text, 4, 160)) reject("lore", l, "text length");
    else if (!grounded(l.text, ctx.utterances[l.source], ctx.lore.get(l.key))) reject("lore", l, "not grounded in what they said");
    else delta.lore.push({ ...l, text: l.text.trim() });
  }

  for (const e of proposed.events) {
    if (!textOk(e.text, 2, 300) || !textOk(e.type, 1, 40)) reject("events", e, "bad event");
    else if (e.locationId && !ctx.locationIds.has(e.locationId)) reject("events", e, "unknown location");
    else delta.events.push(e);
  }

  return { delta, rejected };
}

/** Clamp a stat after applying a delta; bounds are part of the world, not a rejection. */
export const clampStat = (value: number, min = -100, max = 100) => Math.max(min, Math.min(max, value));
