// Background interactions (技术设计 §4.3 layer 3). When residents' days put them in the same
// place at the same time and one of them means something by it (or by chance, in the busy
// places), a cheap model resolves what happened — a summary and proposed changes, never full
// dialogue. With the player standing there, it becomes something they can overhear.

import { randomUUID } from "node:crypto";
import { calendar, loadPrompt, renderPrompt } from "@elmsford/content";
import { computeGameTime, describeTime, emptyDelta, INTERACTION_LIMITS, PLAYER_ID, seededRng, type GameTime, type WorldDelta } from "@elmsford/core";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { presenceOf, type Presence } from "../world/presence";
import { getKnownFacts, getResidents, locationName, logEvent, validateAndApply, type CharacterRow } from "../world/repo";
import { FactIds, residentBrief } from "./brief";
import { customsInBrief } from "./customs";
import { startOfDate } from "./days";

const HOUR = 3_600_000;
const SOCIAL: Record<string, number> = { alehouse: 0.45, green: 0.3, church: 0.25, mill: 0.3, common: 0.15, churchyard: 0.15, ford: 0.15 };
const OTHER_PLACE_CHANCE = 0.08;
const MAX_ENCOUNTERS_PER_PLACE_PER_DAY = 3;

export interface Encounter {
  key: string;
  kind: "meeting" | "visit";
  locationId: string;
  at: number;
  people: CharacterRow[];
  presences: Presence[];
  playerPresent: boolean;
}

function encountersToday(db: Db, villageId: string, dayStart: number): t.WorldEventRow[] {
  return db
    .select()
    .from(t.worldEvents)
    .where(and(eq(t.worldEvents.villageId, villageId), eq(t.worldEvents.type, "encounter"), gte(t.worldEvents.at, dayStart)))
    .all();
}

export interface FindOptions {
  /** Where the player is, if they are in the village right now. */
  playerAt?: string | null;
  /** Only look at this place (for an on-the-spot overheard encounter). */
  onlyAt?: string;
  /** Always produce the encounter if people are there, ignoring the dice (the player is listening). */
  force?: boolean;
  /** Sample who is where at this instant instead of the middle of the hour. */
  at?: number;
}

/** Who meets whom during the hour starting at `slotStart`. Deterministic for a given village and hour. */
export function findEncounters(db: Db, village: Village, slotStart: number, o: FindOptions = {}): Encounter[] {
  const at = o.at ?? slotStart + 30 * 60_000;
  const gt: GameTime = computeGameTime(at, village.timeZone, calendar);
  const residents = getResidents(db, village.id);
  const presences = residents.map((c) => presenceOf(db, village.id, c, gt)).filter((p) => !p.asleep && p.block.locationId !== "kingsbury");
  const done = encountersToday(db, village.id, startOfDate(village, gt.date));
  const doneKeys = new Set(done.map((e) => (e.payload as { key?: string }).key));
  const out: Encounter[] = [];

  const byPlace = new Map<string, Presence[]>();
  for (const p of presences) byPlace.set(p.block.locationId, [...(byPlace.get(p.block.locationId) ?? []), p]);

  for (const [locationId, here] of byPlace) {
    if (o.onlyAt && locationId !== o.onlyAt) continue;
    // Overhearing gets its own key, so it can follow a background encounter in the same hour;
    // the hourly pass skips a place the player already overheard.
    const baseKey = `${gt.date}:${gt.hour}:${locationId}`;
    const heardKey = `${baseKey}:heard`;
    if (doneKeys.has(heardKey) || (!o.force && doneKeys.has(baseKey))) continue;
    const key = o.force ? heardKey : baseKey;
    const playerPresent = o.playerAt === locationId;

    // Someone came to the scribe's door and nobody answered.
    if (locationId === "player_house" && !playerPresent) {
      for (const p of here.filter((x) => x.block.intent && x.block.withIds?.includes(PLAYER_ID))) {
        const vkey = `${baseKey}:visit:${p.character.id}`;
        if (!doneKeys.has(vkey)) out.push({ key: vkey, kind: "visit", locationId, at, people: [p.character], presences: [p], playerPresent: false });
      }
      continue;
    }
    if (here.length < 2) continue;

    const ids = new Set(here.map((p) => p.character.id));
    const purposeful = here.some((p) => p.block.intent && p.block.withIds?.some((id) => ids.has(id)));
    const placeCount = done.filter((e) => (e.payload as { locationId?: string }).locationId === locationId).length;
    if (!purposeful && placeCount >= MAX_ENCOUNTERS_PER_PLACE_PER_DAY && !o.force) continue;
    const chance = purposeful || o.force || playerPresent ? 1 : (SOCIAL[locationId] ?? OTHER_PLACE_CHANCE);
    if (seededRng(`${village.id}:${key}`)() >= chance) continue;
    out.push({ key, kind: "meeting", locationId, at, people: here.map((p) => p.character), presences: here, playerPresent });
  }
  return out;
}

// ------------------------------------------------------------------ resolution

const ResultSchema = z.object({
  encounters: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      memories: z.array(z.object({ characterId: z.string(), text: z.string(), importance: z.number().int() })),
      shared: z.array(z.object({ factId: z.string(), tellerId: z.string(), hearerId: z.string() })),
      news: z.array(z.object({ tellerId: z.string(), hearerId: z.string(), text: z.string() })),
      relationships: z.array(z.object({ from: z.string(), to: z.string(), trustDelta: z.number().int(), affectionDelta: z.number().int() })),
      concerns: z.array(z.object({ characterId: z.string(), add: z.array(z.string()), remove: z.array(z.string()) })),
      public: z.string().nullable(),
      overheard: z.array(z.object({ speakerId: z.string(), text: z.string() })),
      leftForPlayer: z.object({ item: z.string().nullable(), qty: z.number().int().nullable(), message: z.string().nullable() }).nullable(),
    }),
  ),
});
type Resolved = z.infer<typeof ResultSchema>["encounters"][number];

export type ProposedNews = { tellerId: string; hearerId: string; text: string };
export type ProposedShare = { factId: string; tellerId: string; hearerId: string };

/** Shared by encounters and day summaries: model output → proposed delta. */
export function socialDelta(
  facts: FactIds,
  known: (characterId: string) => Map<string, string>,
  x: {
    memories: { characterId: string; text: string; importance: number; participants?: string[] }[];
    shared: ProposedShare[];
    news: ProposedNews[];
    relationships: { from: string; to: string; trustDelta: number; affectionDelta: number }[];
    concerns: { characterId: string; add: string[]; remove: string[] }[];
  },
  participants: string[],
): WorldDelta {
  const d = emptyDelta();
  d.memories = x.memories.map((m) => ({ characterId: m.characterId, text: m.text, importance: m.importance, participants: m.participants ?? participants.filter((p) => p !== m.characterId) }));
  for (const s of x.shared) {
    const real = facts.real(s.factId);
    const text = real ? known(s.tellerId).get(real) : undefined;
    if (real && text) d.facts.push({ characterId: s.hearerId, text, belief: 0.7, source: s.tellerId, factId: real });
  }
  for (const n of x.news) d.facts.push({ characterId: n.hearerId, text: n.text, belief: 0.8, source: n.tellerId });
  d.relationships = x.relationships.filter((r) => r.trustDelta || r.affectionDelta);
  d.concerns = x.concerns;
  return d;
}

/** What a resident can be the source of without having heard it: their own life. */
export function ownNews(c: CharacterRow, extra: string): string {
  return [c.seed.situation, c.seed.household ?? "", ...c.state.concerns, extra].join("\n");
}

function encounterText(db: Db, village: Village, e: Encounter, label: string, facts: FactIds): string {
  const names = e.people.map((c) => `${c.shortName}（${c.id}）`).join("、");
  if (e.kind === "visit") {
    const p = e.presences[0]!;
    return [
      `### 碰面 ${label}：${p.character.shortName}来抄写员家门口找他，敲了门，没人应`,
      `他来是想：${p.block.intent}`,
      residentBrief(db, village, p.character, { now: e.at, facts, others: [PLAYER_ID], memoryLimit: 3 }),
      "这一处只写 summary、memories、concerns，以及 leftForPlayer：他留没留下什么（只能是他手上有的东西）或者托口信（message，一句话）。其余字段给空。",
    ].join("\n");
  }
  const doing = e.presences.map((p) => `${p.character.shortName}在${p.block.activity}${p.block.intent ? `，打算${p.block.intent}` : ""}`).join("；");
  const others = e.people.map((c) => c.id);
  return [
    `### 碰面 ${label}：在${locationName(e.locationId)}${e.playerPresent ? "（抄写员在场）" : ""}`,
    `在场：${names}`,
    `各自在做：${doing}`,
    ...e.people.map((c) => residentBrief(db, village, c, { now: e.at, facts, others: others.filter((id) => id !== c.id), memoryLimit: 3, factLimit: 5 })),
  ].join("\n\n");
}

export interface ResolveResult {
  resolved: number;
  overheard: number;
}

export async function resolveEncounters(db: Db, gateway: LlmGateway, village: Village, encounters: Encounter[]): Promise<ResolveResult> {
  if (!encounters.length) return { resolved: 0, overheard: 0 };
  const facts = new FactIds();
  const labels = encounters.map((_, i) => `E${i + 1}`);
  const gt = computeGameTime(encounters[0]!.at, village.timeZone, calendar);
  const desc = describeTime(gt, calendar);
  const body = encounters.map((e, i) => encounterText(db, village, e, labels[i]!, facts)).join("\n\n---\n\n");

  const r = await gateway.callJson(
    {
      tier: "cheap",
      purpose: "sim.encounters",
      villageId: village.id,
      background: true,
      system: [{ text: loadPrompt("world"), cache: true }],
      messages: [{ role: "user", content: renderPrompt("encounters", { time: `${desc.dateText}，${desc.weekday}，${desc.period}，大约 ${desc.clock}。${customsInBrief(gt)}`, encounters: body }) }],
      maxTokens: 6000,
      effort: "low",
      cacheKey: `elmsford.encounters.${village.id}`,
    },
    "encounters",
    ResultSchema,
  );

  let overheard = 0;
  for (const [i, e] of encounters.entries()) {
    const x: Resolved | undefined = r.data.encounters.find((y) => y.id === labels[i]);
    if (!x) continue;
    overheard += applyEncounter(db, village, e, x, facts) ? 1 : 0;
  }
  return { resolved: encounters.length, overheard };
}

function applyEncounter(db: Db, village: Village, e: Encounter, x: Resolved, facts: FactIds): boolean {
  const ids = e.people.map((c) => c.id);
  const knownCache = new Map<string, Map<string, string>>();
  const known = (id: string) => {
    let m = knownCache.get(id);
    if (!m) {
      m = new Map(getKnownFacts(db, village.id, id).map((f) => [f.id, f.text]));
      knownCache.set(id, m);
    }
    return m;
  };

  const delta = socialDelta(facts, known, x, ids);
  if (e.kind === "visit" && x.leftForPlayer) {
    const c = e.people[0]!;
    const { item, qty, message } = x.leftForPlayer;
    if (item) delta.transfers.push({ from: c.id, to: "loc:player_house", item, quantity: qty && qty > 0 ? qty : 1 });
    const text = [`${c.shortName}来找过你${message ? `，留话说：“${message}”` : "。"}`, item ? `门口留下了${item}${qty && qty > 1 ? `×${qty}` : ""}。` : ""].join("");
    delta.events.push({ type: "visit", text, visibleTo: [PLAYER_ID], locationId: "player_house" });
  }
  if (x.public?.trim()) delta.events.push({ type: "public", text: x.public.trim(), visibleTo: ["public"], locationId: e.locationId });

  const utterances: Record<string, string> = {};
  for (const c of e.people) utterances[c.id] = ownNews(c, x.summary);
  const applied = validateAndApply(db, delta, {
    villageId: village.id,
    now: e.at,
    source: `encounter:${e.key}`,
    participants: e.kind === "visit" ? [...ids] : ids,
    utterances,
    limits: INTERACTION_LIMITS,
    locationId: e.locationId,
  });

  logEvent(db, village.id, e.at, "encounter", { key: e.key, locationId: e.locationId, summary: x.summary, participants: ids, kind: e.kind }, ids);
  if (e.kind === "visit") {
    const gift = applied.applied.transfers[0];
    const c = e.people[0]!;
    db.insert(t.notifications)
      .values({ id: randomUUID(), villageId: village.id, at: e.at, characterId: c.id, text: gift ? `${c.shortName}在你门口留了${gift.item}` : `${c.shortName}来敲过你的门` })
      .run();
  }

  const lines = e.playerPresent
    ? x.overheard
        .filter((l) => ids.includes(l.speakerId) && l.text.trim())
        .slice(0, 8)
        .map((l) => ({ name: e.people.find((c) => c.id === l.speakerId)!.shortName, text: l.text.trim().slice(0, 200) }))
    : [];
  if (lines.length) logEvent(db, village.id, e.at, "overheard", { locationId: e.locationId, lines, participants: ids }, [PLAYER_ID]);
  return lines.length > 0;
}

export function recentOverheard(db: Db, village: Village, locationId: string, now: number) {
  return db
    .select()
    .from(t.worldEvents)
    .where(and(eq(t.worldEvents.villageId, village.id), eq(t.worldEvents.type, "overheard"), gte(t.worldEvents.at, now - HOUR)))
    .all()
    .map((e) => e.payload as { locationId: string; lines: { name: string; text: string }[] })
    .filter((p) => p.locationId === locationId)
    .flatMap((p) => p.lines);
}
