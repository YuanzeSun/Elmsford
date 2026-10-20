// People joining the village (设定圣经 §1：有人来，有人走). Who and when is decided by rule:
//   - a villager steps forward once residents keep talking about them (looked at on Sundays);
//   - a stranger may come in season (looked at each evening, for the next morning).
// When their time comes, the model writes who they are and validateNewcomer decides what holds;
// addResident writes them in. Few people, on purpose: the player has to be able to keep track.

import { randomUUID } from "node:crypto";
import {
  calendar,
  folk,
  inSeason,
  loadPrompt,
  MAX_RESIDENTS,
  MENTION_WINDOW_DAYS,
  MENTIONS_TO_STEP_FORWARD,
  openings,
  renderPrompt,
  STEP_FORWARD_GAP_DAYS,
  type FolkEntry,
  type Opening,
} from "@elmsford/content";
import { computeGameTime, describeTime, seededRng, validateNewcomer, type NewcomerDraft, type NewcomerRules } from "@elmsford/core";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { LlmError, type LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { addResident, getCharacters, getResidents, locationName } from "../world/repo";
import { dateShift, startOfDate } from "./days";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Strangers don't turn up in the player's first week. */
const QUIET_START_DAYS = 7;
/** Writing someone is tried on this many ticks before giving up on them. */
const MAX_ATTEMPTS = 3;
/** Within one try, the model gets this many goes, with what was wrong. */
const DRAFTS_PER_TRY = 2;

export type NewcomerRow = typeof t.newcomers.$inferSelect;

const View = z.object({ personId: z.string(), trust: z.number(), affection: z.number(), summary: z.string() });
const DraftSchema = z.object({
  name: z.string(),
  shortName: z.string(),
  age: z.number(),
  occupation: z.string(),
  personality: z.string(),
  cares: z.string(),
  flaws: z.string(),
  wants: z.string(),
  situation: z.string(),
  speech: z.string(),
  household: z.string(),
  mood: z.string(),
  concerns: z.array(z.string()),
  memories: z.array(z.object({ text: z.string(), importance: z.number() })),
  views: z.array(View),
  seenBy: z.array(View),
});

export function getNewcomers(db: Db, villageId: string): NewcomerRow[] {
  return db.select().from(t.newcomers).where(eq(t.newcomers.villageId, villageId)).orderBy(asc(t.newcomers.at)).all();
}

export function queueNewcomer(db: Db, villageId: string, kind: NewcomerRow["kind"], sourceId: string, at: number, now: number): NewcomerRow | null {
  const rows = getNewcomers(db, villageId);
  if (rows.some((r) => r.status === "pending")) return null;
  const characterId = kind === "folk" ? sourceId : `${sourceId}-${rows.filter((r) => r.sourceId === sourceId).length + 1}`;
  const row = { id: `${villageId}:${characterId}:${at}`, villageId, kind, sourceId, characterId, at, status: "pending" as const, attempts: 0, createdAt: now };
  db.insert(t.newcomers).values(row).onConflictDoNothing().run();
  return row;
}

/** How many things said or remembered in [from, to) bring up each villager. */
export function mentionCounts(db: Db, villageId: string, from: number, to: number): Map<string, number> {
  const texts: string[] = [
    ...db
      .select({ text: t.memories.text })
      .from(t.memories)
      .where(and(eq(t.memories.villageId, villageId), gte(t.memories.at, from), lt(t.memories.at, to)))
      .all()
      .map((m) => m.text),
    ...db
      .select({ text: t.facts.text })
      .from(t.facts)
      .where(and(eq(t.facts.villageId, villageId), gte(t.facts.at, from), lt(t.facts.at, to)))
      .all()
      .map((f) => f.text),
    ...db
      .select({ transcript: t.conversations.transcript })
      .from(t.conversations)
      .where(and(eq(t.conversations.villageId, villageId), gte(t.conversations.startedAt, from), lt(t.conversations.startedAt, to)))
      .all()
      .map((c) => c.transcript.map((l) => l.text).join("\n")),
  ];
  const counts = new Map<string, number>();
  for (const f of folk) counts.set(f.id, texts.filter((x) => f.aliases.some((a) => x.includes(a))).length);
  return counts;
}

/** Sunday evening: has someone been talked about enough to step forward? */
export function considerSteppingForward(db: Db, village: Village, date: string, now: number): NewcomerRow | null {
  const at = startOfDate(village, dateShift(date, 1)) + 6 * HOUR;
  // Keep a place free for whoever might come from outside.
  if (getResidents(db, village.id).length >= MAX_RESIDENTS - 1) return null;
  const last = getNewcomers(db, village.id).filter((r) => r.kind === "folk").at(-1);
  if (last && at - last.at < STEP_FORWARD_GAP_DAYS * DAY) return null;

  const known = new Set(getCharacters(db, village.id).map((c) => c.id));
  const counts = mentionCounts(db, village.id, at - MENTION_WINDOW_DAYS * DAY, at);
  const next = folk
    .filter((f) => !known.has(f.id) && (counts.get(f.id) ?? 0) >= MENTIONS_TO_STEP_FORWARD)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
  return next ? queueNewcomer(db, village.id, "folk", next.id, at, now) : null;
}

/** Each evening: does someone from outside turn up tomorrow? */
export function considerArrival(db: Db, village: Village, date: string, now: number): NewcomerRow | null {
  const tomorrow = dateShift(date, 1);
  const morning = startOfDate(village, tomorrow);
  if (morning - village.createdAt < QUIET_START_DAYS * DAY) return null;
  if (getResidents(db, village.id).length >= MAX_RESIDENTS) return null;
  const rows = getNewcomers(db, village.id);
  const rng = seededRng(`${village.id}:${tomorrow}:arrival`);
  for (const o of openings) {
    if (!inSeason(o, tomorrow)) continue;
    const last = rows.filter((r) => r.sourceId === o.id).at(-1);
    if (last && morning - last.at < o.cooldownDays * DAY) continue;
    if (rng() >= o.chancePerDay) continue;
    return queueNewcomer(db, village.id, "arrival", o.id, morning + 10 * HOUR, now);
  }
  return null;
}

function whoText(source: FolkEntry | Opening, host: string | null): string {
  if ("shortName" in source) {
    return `${source.name}（大家叫${source.shortName}），${source.age} 岁，${source.occupation}。住在${locationName(source.homeId)}。${source.sketch}`;
  }
  const o = source as Opening;
  return [
    o.sketch,
    `年纪在 ${o.ages[0]} 到 ${o.ages[1]} 岁之间。营生：${o.occupation}。住处：${locationName(o.homeId)}${host ? `，借住在${host}家` : ""}。`,
    o.stay ? "只在村里待几天就走。" : "",
    o.familiar ? "小时候在村里长大，村里上了年纪的人也许还记得她家。" : "",
  ].join("");
}

/** What residents have said about a villager lately, newest first. */
function heardAbout(db: Db, villageId: string, f: FolkEntry, since: number): string[] {
  const hits = (text: string) => f.aliases.some((a) => text.includes(a));
  const mems = db
    .select({ text: t.memories.text, at: t.memories.at })
    .from(t.memories)
    .where(and(eq(t.memories.villageId, villageId), gte(t.memories.at, since)))
    .all()
    .filter((m) => hits(m.text));
  const facts = db
    .select({ text: t.facts.text, at: t.facts.at })
    .from(t.facts)
    .where(and(eq(t.facts.villageId, villageId), gte(t.facts.at, since)))
    .all()
    .filter((x) => hits(x.text));
  const households = getResidents(db, villageId)
    .filter((c) => c.seed.household && hits(c.seed.household))
    .map((c) => ({ text: `${c.shortName}家里：${c.seed.household}`, at: Number.MAX_SAFE_INTEGER }));
  return [...households, ...mems, ...facts]
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)
    .map((x) => x.text);
}

/** Ask the model for the person, a couple of times with what was wrong; null if it never held. */
async function draft(db: Db, gateway: LlmGateway, village: Village, row: NewcomerRow, task: string, rules: NewcomerRules) {
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: task }];
  for (let i = 0; i < DRAFTS_PER_TRY; i++) {
    const r = await gateway.callJson(
      {
        tier: "planner",
        purpose: "sim.newcomer",
        villageId: village.id,
        background: true,
        system: [{ text: loadPrompt("world"), cache: true }],
        messages,
        maxTokens: 3000,
        effort: "medium",
      },
      "newcomer",
      DraftSchema,
    );
    const check = validateNewcomer(r.data as NewcomerDraft, rules);
    if (check.ok) return check.newcomer;
    db.insert(t.rejections)
      .values({ id: randomUUID(), villageId: village.id, at: row.at, source: `newcomer:${row.characterId}`, field: "newcomer", item: r.data, reason: check.errors.join("；") })
      .run();
    messages.push(
      { role: "assistant", content: JSON.stringify(r.data) },
      { role: "user", content: `这几处不行：\n${check.errors.map((e) => `- ${e}`).join("\n")}\n改好了再写一份。` },
    );
  }
  return null;
}

async function write(db: Db, gateway: LlmGateway, village: Village, row: NewcomerRow): Promise<boolean> {
  const residents = getResidents(db, village.id);
  const everyone = getCharacters(db, village.id);
  const f = row.kind === "folk" ? folk.find((x) => x.id === row.sourceId) : undefined;
  const o = row.kind === "arrival" ? openings.find((x) => x.id === row.sourceId) : undefined;
  if (!f && !o) return false;
  const host = o?.hostId ? (residents.find((c) => c.id === o.hostId) ?? null) : null;

  const taken = new Set([
    ...everyone.flatMap((c) => [c.name, c.shortName]),
    ...folk.filter((x) => x.id !== f?.id).flatMap((x) => [x.name, x.shortName]),
    ...db
      .select({ name: t.remotePeople.name })
      .from(t.remotePeople)
      .where(eq(t.remotePeople.villageId, village.id))
      .all()
      .map((p) => p.name),
  ]);
  const rules: NewcomerRules = {
    ...(f ? { fixed: { name: f.name, shortName: f.shortName, age: f.age } } : {}),
    occupation: (f ?? o)!.occupation,
    ages: f ? [f.age, f.age] : o!.ages,
    taken,
    residents: new Set(residents.map((c) => c.id)),
    // Someone who lives here knows everyone; someone back after years, a little; a stranger, nobody yet.
    maxFeeling: f ? 70 : o!.familiar ? 40 : 20,
  };

  const time = describeTime(computeGameTime(row.at, village.timeZone, calendar), calendar);
  const heard = f ? heardAbout(db, village.id, f, row.at - MENTION_WINDOW_DAYS * DAY) : [];
  const task = renderPrompt("newcomer", {
    who: whoText((f ?? o)!, host?.shortName ?? null),
    heard: heard.length ? heard.map((x) => `- ${x}`).join("\n") : f ? "- 没怎么听人说起。" : "- 刚来，还没人说起。",
    residents: residents
      .map((c) => `- ${c.name}（id：${c.id}，${c.age} 岁，${c.seed.occupation}）：${c.seed.personality}${c.seed.household ? ` 家里：${c.seed.household}` : ""}`)
      .join("\n"),
    time: `${time.headline}，${time.season}。`,
    taken: [...new Set([...everyone.map((c) => c.shortName), ...folk.filter((x) => x.id !== f?.id).map((x) => x.shortName)])].join("、"),
  });

  const person = await draft(db, gateway, village, row, task, rules);
  if (!person) return false;

  const source = (f ?? o)!;
  const stay = o?.stay;
  const arrivalDate = computeGameTime(row.at, village.timeZone, calendar).date;
  const days = stay ? stay[0] + Math.floor(seededRng(`${row.id}:stay`)() * (stay[1] - stay[0] + 1)) : 0;
  addResident(db, village.id, {
    id: row.characterId,
    origin: row.kind,
    person,
    homeId: source.homeId,
    routine: source.routine,
    economy: source.economy,
    health: 85,
    money: source.money,
    items: source.items,
    at: row.at,
    leavesOn: stay ? dateShift(arrivalDate, days) : null,
    seenAs: f ? "同村的人，没什么来往" : `新来的${o!.occupation}，还不知道底细`,
    seesOthersAs: f ? "同村的人，没什么来往" : "还不熟",
    seesPlayerAs: f ? "新来的写字的，听家里人说起过" : "村里那个写字的，听人提过",
    ...(o ? { announce: o.announce.replaceAll("{name}", person.shortName) } : {}),
  });
  return true;
}

/** Write in everyone whose time has come (by `upTo`, game time). Background work: it can wait. */
export async function welcome(db: Db, gateway: LlmGateway, village: Village, upTo: number): Promise<void> {
  for (const row of getNewcomers(db, village.id).filter((r) => r.status === "pending" && r.at <= upTo)) {
    const set = (status: NewcomerRow["status"], attempts = row.attempts) =>
      db.update(t.newcomers).set({ status, attempts }).where(eq(t.newcomers.id, row.id)).run();
    const known = getCharacters(db, village.id).some((c) => c.id === row.characterId);
    if (known || getResidents(db, village.id).length >= MAX_RESIDENTS) {
      set("dropped");
      continue;
    }
    try {
      const ok = await write(db, gateway, village, row);
      if (ok) set("done");
      else set(row.attempts + 1 >= MAX_ATTEMPTS ? "dropped" : "pending", row.attempts + 1);
    } catch (err) {
      if (err instanceof LlmError && err.kind === "over_budget") return;
      set(row.attempts + 1 >= MAX_ATTEMPTS ? "dropped" : "pending", row.attempts + 1);
      throw err;
    }
  }
}
