// Weekly reflection (技术设计 §4.9): a week of memories pressed into a few views; old details
// fade. This is the only path by which personality may shift — one small step a week at most,
// always with a reason, and the seed itself never changes.

import { randomUUID } from "node:crypto";
import { calendar, loadPrompt, renderPrompt } from "@elmsford/content";
import { computeGameTime, describeTime, emptyDelta, INTERACTION_LIMITS, PLAYER_ID, relativeTimePhrase } from "@elmsford/core";
import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { getCharacters, getResidents, validateAndApply } from "../world/repo";
import { personaNotes } from "./brief";

const DAY = 86_400_000;
const FADE = 0.7;
const FADE_AFTER_DAYS = 14;

const ReflectionSchema = z.object({
  residents: z.array(
    z.object({
      id: z.string(),
      views: z.array(z.object({ text: z.string(), importance: z.number().int() })),
      relationshipSummaries: z.array(z.object({ personId: z.string(), summary: z.string() })),
      persona: z.object({ text: z.string(), reason: z.string() }).nullable(),
    }),
  ),
});

export async function reflectWeek(db: Db, gateway: LlmGateway, village: Village, weekEnd: number): Promise<void> {
  const weekStart = weekEnd - 7 * DAY;
  const residents = getResidents(db, village.id);
  const all = getCharacters(db, village.id);
  const nameOf = (id: string) => (id === PLAYER_ID ? "抄写员" : all.find((c) => c.id === id)?.shortName ?? id);
  const when = (at: number) => relativeTimePhrase(at, weekEnd, village.timeZone, calendar);

  const sections = residents.map((c) => {
    const mems = db
      .select()
      .from(t.memories)
      .where(and(eq(t.memories.villageId, village.id), eq(t.memories.characterId, c.id), eq(t.memories.kind, "event"), gte(t.memories.at, weekStart), lt(t.memories.at, weekEnd)))
      .all();
    const rels = db.select().from(t.relationships).where(and(eq(t.relationships.villageId, village.id), eq(t.relationships.fromId, c.id))).all();
    return {
      c,
      count: mems.length,
      text: [
        `### ${c.name}（id：${c.id}）`,
        `性格：${c.seed.personality} 在乎：${c.seed.cares} 毛病：${c.seed.flaws}`,
        ...personaNotes(db, village.id, c.id).map((n) => `以前的变化：${n}`),
        `对人的印象：${rels.map((r) => `${nameOf(r.toId)}（${r.toId}）——${r.summary}`).join("；")}`,
        `这一周记住的事：`,
        ...(mems.length ? mems.map((m) => `- ${when(m.at)}：${m.text}`) : ["- 没什么特别的。"]),
      ].join("\n"),
    };
  });
  if (!sections.some((s) => s.count > 0)) return;

  const r = await gateway.callJson(
    {
      tier: "planner",
      purpose: "sim.reflection",
      villageId: village.id,
      background: true,
      system: [{ text: loadPrompt("world"), cache: true }],
      messages: [{ role: "user", content: renderPrompt("reflection", { week: `到${describeTime(computeGameTime(weekEnd - 1, village.timeZone, calendar), calendar).dateText}为止的一周`, residents: sections.map((s) => s.text).join("\n\n") }) }],
      maxTokens: 6000,
      effort: "low",
      cacheKey: `elmsford.reflection.${village.id}`,
    },
    "reflection",
    ReflectionSchema,
  );

  for (const x of r.data.residents) {
    const c = residents.find((y) => y.id === x.id);
    if (!c) continue;
    const delta = emptyDelta();
    // Views of people they actually know: residents (gone or not) and the scribe.
    const known = x.relationshipSummaries.filter((s) => s.personId !== c.id && (s.personId === PLAYER_ID || all.some((y) => y.id === s.personId)));
    const others = [...new Set(known.map((s) => s.personId))];
    for (const s of known) {
      delta.relationships.push({ from: c.id, to: s.personId, trustDelta: 0, affectionDelta: 0, newSummary: s.summary.slice(0, 60) });
    }
    validateAndApply(db, delta, {
      villageId: village.id,
      now: weekEnd,
      source: `reflection:${c.id}`,
      participants: [c.id, ...others],
      utterances: {},
      limits: INTERACTION_LIMITS,
    });
    for (const v of x.views.slice(0, 3)) {
      if (v.text.trim().length < 4) continue;
      db.insert(t.memories)
        .values({
          id: randomUUID(),
          villageId: village.id,
          characterId: c.id,
          at: weekEnd,
          text: v.text.trim().slice(0, 200),
          importance: Math.max(5, Math.min(8, v.importance)),
          participants: [],
          factIds: [],
          kind: "reflection",
        })
        .run();
    }
    if (x.persona && x.persona.text.trim() && x.persona.reason.trim()) {
      db.insert(t.personaNotes)
        .values({ id: randomUUID(), villageId: village.id, characterId: c.id, at: weekEnd, text: x.persona.text.trim().slice(0, 60), reason: x.persona.reason.trim().slice(0, 160) })
        .run();
    }
  }

  // Old details count for less from now on.
  const cutoff = weekEnd - FADE_AFTER_DAYS * DAY;
  for (const m of db.select().from(t.memories).where(and(eq(t.memories.villageId, village.id), eq(t.memories.kind, "event"), lt(t.memories.at, cutoff))).all()) {
    if (m.weight > 0.2) db.update(t.memories).set({ weight: m.weight * FADE }).where(eq(t.memories.id, m.id)).run();
  }
}
