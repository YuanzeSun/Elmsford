// core/extraction (技术设计 §4.7): after a conversation, a cheap model turns the transcript into a
// proposed ConversationDelta. The validator then decides what of it becomes true.

import { calendar, customs, renderPrompt, VILLAGE } from "@elmsford/content";
import { computeGameTime, CONVERSATION_LIMITS, describeTime, emptyDelta, PLAYER_ID, type WorldDelta } from "@elmsford/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { getCharacter, getCommitments, getRelationship, locationName, resolveCommitments, validateAndApply, type ApplyResult } from "../world/repo";

const DAY = 86_400_000;

export const ExtractionSchema = z.object({
  memories: z.array(z.object({ text: z.string(), importance: z.number().int(), participants: z.array(z.string()) })),
  factsLearned: z.array(z.object({ text: z.string(), belief: z.number() })),
  commitments: z.array(z.object({ by: z.string(), to: z.string(), text: z.string(), dueInDays: z.number().nullable() })),
  relationship: z.object({ trustDelta: z.number().int(), affectionDelta: z.number().int(), newSummary: z.string().nullable() }),
  concerns: z.object({ add: z.array(z.string()), remove: z.array(z.string()) }),
  playerNotes: z.array(z.string()),
  keptCommitments: z.array(z.number().int()),
  customsTold: z.array(z.object({ key: z.string(), text: z.string() })),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export function transcriptText(lines: t.TranscriptLine[], name: string): string {
  return lines
    .map((l) => (l.speaker === "scene" || l.speaker === "narration" ? `（${l.text}）` : `${l.speaker === PLAYER_ID ? "抄写员" : name}：${l.text}`))
    .join("\n");
}

/** Turn the model's output into a proposed delta (still unvalidated). */
export function toDelta(x: Extraction, characterId: string, now: number): WorldDelta {
  const d = emptyDelta();
  d.memories = x.memories.map((m) => ({ characterId, text: m.text, importance: m.importance, participants: m.participants }));
  d.facts = x.factsLearned.map((f) => ({ characterId, text: f.text, belief: f.belief, source: PLAYER_ID }));
  d.commitments = x.commitments.map((c) => ({
    by: c.by,
    to: c.to,
    text: c.text,
    ...(c.dueInDays !== null && c.dueInDays > 0 ? { due: now + Math.round(c.dueInDays * DAY) } : {}),
  }));
  if (x.relationship.trustDelta || x.relationship.affectionDelta || x.relationship.newSummary) {
    d.relationships = [
      {
        from: characterId,
        to: PLAYER_ID,
        trustDelta: x.relationship.trustDelta,
        affectionDelta: x.relationship.affectionDelta,
        ...(x.relationship.newSummary ? { newSummary: x.relationship.newSummary } : {}),
      },
    ];
  }
  if (x.concerns.add.length || x.concerns.remove.length) d.concerns = [{ characterId, add: x.concerns.add, remove: x.concerns.remove }];
  d.playerNotes = x.playerNotes.map((text) => ({ characterId, text }));
  d.lore = x.customsTold.map((l) => ({ key: l.key, text: l.text, source: characterId }));
  return d;
}

export async function extractConversation(db: Db, gateway: LlmGateway, village: Village, conversationId: string): Promise<ApplyResult | null> {
  const conv = db.select().from(t.conversations).where(eq(t.conversations.id, conversationId)).get();
  if (!conv || conv.extraction === "done") return null;
  const c = getCharacter(db, village.id, conv.characterId);
  if (!c) return null;
  const playerLines = conv.transcript.filter((l) => l.speaker === PLAYER_ID);
  if (!playerLines.length) {
    db.update(t.conversations).set({ extraction: "done" }).where(eq(t.conversations.id, conversationId)).run();
    return null;
  }

  const at = conv.endedAt ?? conv.startedAt;
  const gt = computeGameTime(at, village.timeZone, calendar);
  const rel = getRelationship(db, village.id, c.id, PLAYER_ID);
  const open = getCommitments(db, village.id, { between: [c.id, PLAYER_ID], status: "open" });

  const prompt = renderPrompt("extraction", {
    name: c.name,
    id: c.id,
    seed: `${c.seed.occupation}。${c.seed.personality}在乎：${c.seed.cares}`,
    time: describeTime(gt, calendar).headline,
    place: locationName(conv.locationId),
    concerns: c.state.concerns.length ? c.state.concerns.map((x) => `- ${x}`).join("\n") : "（没有）",
    relationship: rel ? `${rel.summary}（信任 ${rel.trust}，好感 ${rel.affection}）` : "生人",
    commitments: open.length ? open.map((x, i) => `${i + 1}. ${x.byId === PLAYER_ID ? "抄写员答应" : `${c.shortName}答应`}：${x.text}`).join("\n") : "（没有）",
    transcript: transcriptText(conv.transcript, c.shortName),
    customs: customs.map((x) => `- ${x.key}：${x.name}`).join("\n"),
  });

  try {
    const result = await gateway.callJson(
      {
        tier: "cheap",
        purpose: `extraction.${c.id}`,
        villageId: village.id,
        system: [{ text: `你是《${VILLAGE}》的记录员，只按要求整理对话里真实发生的事。`, cache: true }],
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4000,
        effort: "low",
        cacheKey: `elmsford.extraction.${village.id}`,
      },
      "conversation_delta",
      ExtractionSchema,
    );

    const applied = validateAndApply(db, toDelta(result.data, c.id, at), {
      villageId: village.id,
      now: at,
      source: `conversation:${conversationId}`,
      participants: [c.id, PLAYER_ID],
      utterances: {
        [PLAYER_ID]: playerLines.map((l) => l.text).join("\n"),
        [c.id]: conv.transcript.filter((l) => l.speaker === c.id).map((l) => l.text).join("\n"),
      },
      limits: CONVERSATION_LIMITS,
      locationId: conv.locationId,
    });
    const kept = result.data.keptCommitments.map((n) => open[n - 1]?.id).filter((id): id is string => Boolean(id));
    resolveCommitments(db, village.id, kept, "kept", at);
    db.update(t.conversations).set({ extraction: "done" }).where(eq(t.conversations.id, conversationId)).run();
    return applied;
  } catch (err) {
    db.update(t.conversations).set({ extraction: "failed" }).where(eq(t.conversations.id, conversationId)).run();
    throw err;
  }
}
