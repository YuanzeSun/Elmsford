// core/scribe (技术设计 §4.10): the client dictates; the player writes. Both texts are kept and
// may differ — the client can't read. Letters go with the Thursday carrier to Kingsbury; a
// distant person (invented once, then fixed) answers what was actually *written*, weeks later.

import { randomUUID } from "node:crypto";
import { calendar, loadPrompt, renderPrompt } from "@elmsford/content";
import { computeGameTime, CONVERSATION_LIMITS, emptyDelta, PLAYER_ID, recallMemories, relativeTimePhrase, seededRng } from "@elmsford/core";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { getCharacter, getMemories, logEvent, validateAndApply } from "../world/repo";

export type DocumentRow = typeof t.documents.$inferSelect;

const DAY = 86_400_000;
export const FEES: Record<DocumentRow["kind"], number> = { letter: 2, contract: 4, will: 6, record: 3 };
export const KIND_NAMES: Record<DocumentRow["kind"], string> = { letter: "信", contract: "契约", will: "遗嘱", record: "记录" };
/** A letter that never gets an answer: lost on the road, or nobody to write back. */
const LOST_CHANCE = 0.1;

export function getDocument(db: Db, villageId: string, id: string): DocumentRow | undefined {
  return db.select().from(t.documents).where(and(eq(t.documents.villageId, villageId), eq(t.documents.id, id))).get();
}

export function listDocuments(db: Db, villageId: string): DocumentRow[] {
  return db.select().from(t.documents).where(eq(t.documents.villageId, villageId)).all();
}

/** The client dictates, in their own voice. Streams. */
export async function dictate(db: Db, gateway: LlmGateway, village: Village, doc: DocumentRow, now: number, onText: (d: string) => void): Promise<string> {
  const c = getCharacter(db, village.id, doc.commissionedBy);
  if (!c) throw new Error("委托人不在了");
  const recall = recallMemories(getMemories(db, village.id, c.id), { now, query: `${doc.gist} ${doc.recipient ?? ""}`, focusIds: [PLAYER_ID], limit: 6, echoChance: 0 });
  const when = (at: number) => relativeTimePhrase(at, now, village.timeZone, calendar);
  const prompt = renderPrompt("dictation", {
    name: c.name,
    seed: `${c.age} 岁，${c.seed.occupation}。性格：${c.seed.personality} 在乎：${c.seed.cares} 毛病：${c.seed.flaws} 心底想要：${c.seed.wants} 说话：${c.seed.speech}`,
    kind: `一份${KIND_NAMES[doc.kind]}`,
    recipient: doc.recipient ? `，写给${doc.recipient}` : "",
    gist: doc.gist || "（没细说）",
    memories: recall.items.length ? recall.items.map((m) => `- ${when(m.at)}：${m.text}`).join("\n") : "- 没什么特别的。",
  });
  const r = await gateway.call({
    tier: "dialogue",
    purpose: `scribe.dictation.${c.id}`,
    villageId: village.id,
    system: [{ text: loadPrompt("world"), cache: true }],
    messages: [{ role: "user", content: prompt }],
    maxTokens: 3000,
    effort: "low",
    cacheKey: `elmsford.dictation.${village.id}`,
    onText,
  });
  const text = r.text.trim();
  db.update(t.documents).set({ dictated: text }).where(eq(t.documents.id, doc.id)).run();
  return text;
}

export function saveWritten(db: Db, doc: DocumentRow, written: string) {
  if (doc.sealedAt) throw new Error("已经封好了，改不了");
  db.update(t.documents).set({ written: written.slice(0, 8000) }).where(eq(t.documents.id, doc.id)).run();
}

/** Done writing: the client pays what they can; letters wait for Thursday, other papers are handed over. */
export function seal(db: Db, village: Village, doc: DocumentRow, now: number): { fee: number; owed: number } {
  if (doc.sealedAt) return { fee: doc.feePence ?? 0, owed: 0 };
  if (doc.written.trim().length < 10) throw new Error("还没写什么");
  const c = getCharacter(db, village.id, doc.commissionedBy);
  const fee = FEES[doc.kind];
  const paid = Math.min(fee, c?.state.money ?? 0);
  if (c && paid > 0) {
    const delta = emptyDelta();
    delta.transfers.push({ from: c.id, to: PLAYER_ID, pence: paid });
    validateAndApply(db, delta, { villageId: village.id, now, source: `document:${doc.id}:fee`, participants: [c.id, PLAYER_ID], utterances: {}, limits: CONVERSATION_LIMITS });
  }
  const owed = fee - paid;
  if (c && owed > 0) {
    db.insert(t.commitments)
      .values({ id: randomUUID(), villageId: village.id, byId: c.id, toId: PLAYER_ID, text: `还抄写员写${KIND_NAMES[doc.kind]}的 ${owed} 便士`, due: now + 30 * DAY, status: "open", createdAt: now })
      .run();
  }
  const handedOver = doc.kind !== "letter";
  db.update(t.documents)
    .set({ sealedAt: now, feePence: paid, ...(handedOver ? { status: "delivered" as const, deliveredAt: now } : {}) })
    .where(eq(t.documents.id, doc.id))
    .run();
  logEvent(db, village.id, now, "document_sealed", { documentId: doc.id, kind: doc.kind, by: doc.commissionedBy, paid, owed }, [doc.commissionedBy, PLAYER_ID]);
  return { fee: paid, owed };
}

// ------------------------------------------------------------------ the distant correspondent

const RemoteSchema = z.object({ name: z.string(), relation: z.string(), place: z.string(), alive: z.boolean(), description: z.string() });

async function remotePersonFor(db: Db, gateway: LlmGateway, village: Village, doc: DocumentRow, now: number) {
  if (doc.remotePersonId) return db.select().from(t.remotePeople).where(eq(t.remotePeople.id, doc.remotePersonId)).get();
  const existing = db
    .select()
    .from(t.remotePeople)
    .where(and(eq(t.remotePeople.villageId, village.id), eq(t.remotePeople.linkedCharacterId, doc.commissionedBy)))
    .all()
    .find((p) => doc.recipient && (doc.recipient.includes(p.name) || doc.recipient.includes(p.relation) || p.relation.includes(doc.recipient)));
  if (existing) return existing;

  const c = getCharacter(db, village.id, doc.commissionedBy)!;
  const r = await gateway.callJson(
    {
      tier: "planner",
      purpose: "scribe.remote_person",
      villageId: village.id,
      background: true,
      system: [{ text: loadPrompt("world"), cache: true }],
      messages: [
        {
          role: "user",
          content: renderPrompt("remote-person", {
            writer: `${c.name}，${c.age} 岁，${c.seed.occupation}。${c.seed.situation} ${c.seed.wants}`,
            recipient: doc.recipient ?? "（信上没写清）",
            letter: doc.written,
          }),
        },
      ],
      maxTokens: 3000,
      effort: "low",
      cacheKey: `elmsford.remote.${village.id}`,
    },
    "remote_person",
    RemoteSchema,
  );
  const id = randomUUID();
  const p = r.data;
  db.insert(t.remotePeople)
    .values({ id, villageId: village.id, name: p.name.slice(0, 40), relation: p.relation.slice(0, 80), linkedCharacterId: c.id, description: p.description.slice(0, 800), place: p.place.slice(0, 80), alive: p.alive, createdAt: now })
    .run();
  return db.select().from(t.remotePeople).where(eq(t.remotePeople.id, id)).get();
}

/** Thursday evening: the carrier takes every sealed letter to Kingsbury. */
export async function dispatchLetters(db: Db, gateway: LlmGateway, village: Village, at: number): Promise<number> {
  const ready = db
    .select()
    .from(t.documents)
    .where(and(eq(t.documents.villageId, village.id), eq(t.documents.kind, "letter"), isNotNull(t.documents.sealedAt), isNull(t.documents.sentAt), isNull(t.documents.replyToId)))
    .all();
  let sent = 0;
  for (const doc of ready) {
    let person;
    try {
      person = await remotePersonFor(db, gateway, village, doc, at);
    } catch (err) {
      console.error("remote person failed; letter waits a week:", err instanceof Error ? err.message : err);
      continue;
    }
    const rng = seededRng(`${village.id}:${doc.id}:post`);
    const lost = rng() < LOST_CHANCE;
    const replyDueAt = lost ? null : at + Math.round((14 + rng() * 28) * DAY);
    db.update(t.documents)
      .set({ status: "sent", sentAt: at, replyDueAt, remotePersonId: person?.id ?? null })
      .where(eq(t.documents.id, doc.id))
      .run();
    logEvent(db, village.id, at, "letter_sent", { documentId: doc.id, by: doc.commissionedBy, recipient: doc.recipient }, [PLAYER_ID, doc.commissionedBy]);
    sent++;
  }
  return sent;
}

/** Thursday: the carrier also brings back whatever replies are due. */
export async function deliverReplies(db: Db, gateway: LlmGateway, village: Village, at: number): Promise<number> {
  const waiting = db
    .select()
    .from(t.documents)
    .where(and(eq(t.documents.villageId, village.id), eq(t.documents.status, "sent"), isNotNull(t.documents.replyDueAt)))
    .all()
    .filter((d) => d.replyDueAt! <= at);
  let delivered = 0;
  for (const doc of waiting) {
    const person = doc.remotePersonId ? db.select().from(t.remotePeople).where(eq(t.remotePeople.id, doc.remotePersonId)).get() : undefined;
    if (!person) continue;
    const c = getCharacter(db, village.id, doc.commissionedBy);
    try {
      const r = await gateway.call({
        tier: "planner",
        purpose: "scribe.remote_reply",
        villageId: village.id,
        background: true,
        system: [{ text: loadPrompt("world"), cache: true }],
        messages: [
          {
            role: "user",
            content: renderPrompt("remote-reply", {
              author: person.alive ? person.name : `${person.name}的家里人（${person.name}已经不在了）`,
              person: `${person.name}，${person.relation}，住在${person.place}。${person.description}${person.alive ? "" : `他已经去世了，回信的是他家里的人。`}`,
              letter: doc.written,
            }),
          },
        ],
        maxTokens: 4000,
        effort: "low",
        cacheKey: `elmsford.reply.${village.id}`,
      });
      const replyId = randomUUID();
      db.transaction((tx) => {
        tx.insert(t.documents)
          .values({
            id: replyId,
            villageId: village.id,
            kind: "letter",
            commissionedBy: doc.commissionedBy,
            dictated: "",
            written: r.text.trim(),
            recipient: c?.name ?? null,
            status: "delivered",
            createdAt: at,
            gist: `${person.name}的回信`,
            remotePersonId: person.id,
            replyToId: doc.id,
            deliveredAt: at,
          })
          .run();
        tx.update(t.documents).set({ status: "replied" }).where(eq(t.documents.id, doc.id)).run();
        tx.insert(t.notifications)
          .values({ id: randomUUID(), villageId: village.id, at, characterId: doc.commissionedBy, text: `商贩捎来一封给${c?.shortName ?? "人"}的回信` })
          .run();
      });
      logEvent(db, village.id, at, "letter_arrived", { documentId: replyId, for: doc.commissionedBy, from: person.name }, [PLAYER_ID]);
      delivered++;
    } catch (err) {
      console.error("reply failed; will try next market day:", err instanceof Error ? err.message : err);
    }
  }
  return delivered;
}

/** The player reads a letter out loud to the person it's for. What they read may not be what it says. */
export function markRead(db: Db, doc: DocumentRow, readAloud: string, at: number) {
  db.update(t.documents).set({ readAt: at, readAloud: readAloud.slice(0, 8000) }).where(eq(t.documents.id, doc.id)).run();
}

export function isThursday(village: Village, at: number) {
  return computeGameTime(at, village.timeZone, calendar).weekday === 4;
}
