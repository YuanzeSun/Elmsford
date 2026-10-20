// core/conversation (技术设计 §4.6): talking with one resident. Lines stream as they are written;
// the resident may hand something over, ask for a letter, or walk off. When the conversation
// ends, extraction runs in the background and the validator decides what is remembered.

import { randomUUID } from "node:crypto";
import { calendar, storyDay } from "@elmsford/content";
import { computeGameTime, CONVERSATION_LIMITS, emptyDelta, PLAYER_ID, type Clock } from "@elmsford/core";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { LlmError, toWireSchema, type LlmGateway } from "../llm/gateway";
import type { ChatMessage, ToolCall, ToolSpec } from "../llm/types";
import { getVillage, type Village } from "../village";
import { markBusy, presenceOf } from "../world/presence";
import { getCharacter, logEvent, markRecalled, validateAndApply, type CharacterRow } from "../world/repo";
import { getDocument, KIND_NAMES, markRead } from "../scribe/letters";
import { passedText, talkMinutes, type StoryTime } from "../sim/story";
import { availability, buildDossier, stableSystem } from "./context";
import { extractConversation } from "./extraction";

const MINUTE = 60_000;
/** A resident who ends a conversation is out of reach for a while. */
const BUSY_AFTER_LEAVING = 40 * MINUTE;
/** A conversation nobody has spoken in for this long (game time) is over. */
const IDLE_TIMEOUT = 30 * MINUTE;
const MAX_TURNS = 40;
const MAX_PLAYER_CHARS = 600;

export type ConversationRow = typeof t.conversations.$inferSelect;

export type StreamEvent =
  | { type: "start"; conversationId: string; characterId: string; name: string }
  | { type: "text"; delta: string }
  | { type: "action"; text: string }
  /** Something around them: a bell, time gone by. */
  | { type: "scene"; text: string }
  | { type: "end"; by: "player" | "character" | "time"; text?: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type Emit = (e: StreamEvent) => void;

const GiveInput = z.object({
  item: z.string().nullable().describe("要给的东西，必须是你手上有的；给钱时为 null"),
  quantity: z.number().int().nullable().describe("给几个；给钱时为 null"),
  pence: z.number().int().nullable().describe("给多少便士；给东西时为 null"),
});
const AskInput = z.object({
  kind: z.enum(["letter", "contract", "will", "record"]).describe("信、契约、遗嘱，或者账目之类的记录"),
  recipient: z.string().nullable().describe("写给谁（信才有）"),
  gist: z.string().describe("你想写的大意，用你自己的话"),
});
const LeaveInput = z.object({ reason: z.string().describe("为什么走，简短") });
const TimeInput = z.object({
  minutes: z.number().int().describe("大概多少分钟"),
  doing: z.string().describe("在做什么，简短"),
});

const TOOLS: ToolSpec[] = [
  { name: "give", description: "把你手上真有的东西或钱给抄写员。", schema: toWireSchema(GiveInput) },
  { name: "ask_to_write", description: "现在就开口托抄写员替你写一份东西。", schema: toWireSchema(AskInput) },
  { name: "leave", description: "你要走了，或者不想再说了。说完最后一句话再用。", schema: toWireSchema(LeaveInput) },
];

/** Story mode: the resident says how long something done together took. Talk alone is counted by how much was said. */
const TIME_TOOL: ToolSpec = {
  name: "time_passes",
  description: "这一来一回里不光是说话，还一起做了要花工夫的事（帮着干活、一起走一段路、坐着歇了好一阵、吃了顿饭），用它记下大概花了多少分钟。话还是照常说，做完这件事之后你说什么、做什么，照样写出来。光是说话不用它。",
  schema: toWireSchema(TimeInput),
};

function toMessages(transcript: t.TranscriptLine[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const line of transcript) {
    const role = line.speaker === PLAYER_ID || line.speaker === "scene" ? "user" : "assistant";
    const content =
      line.speaker === PLAYER_ID
        ? `抄写员：${line.text}`
        : line.speaker === "narration" || line.speaker === "scene"
          ? `（${line.text}）`
          : line.text;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

export class ConversationService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly gateway: LlmGateway,
    /** Story mode's clock; time passes with every exchange. */
    private readonly story?: StoryTime,
  ) {}

  get(id: string): ConversationRow | undefined {
    return this.db.select().from(t.conversations).where(eq(t.conversations.id, id)).get();
  }

  active(villageId: string): ConversationRow | undefined {
    return this.db
      .select()
      .from(t.conversations)
      .where(and(eq(t.conversations.villageId, villageId), isNull(t.conversations.endedAt)))
      .get();
  }

  /** The player walks up to someone. They react first. */
  async start(village: Village, characterId: string, emit: Emit): Promise<void> {
    const now = this.clock.now();
    const current = this.active(village.id);
    if (current) await this.end(village, current.id, "player", emit, { quiet: true });

    const c = getCharacter(this.db, village.id, characterId);
    if (!c || c.status !== "here") return emit({ type: "error", message: "没有这个人。" });
    const ok = availability(this.db, village, c, now, village.playerLocationId);
    if (!ok.ok) return emit({ type: "error", message: ok.reason });

    const gt = computeGameTime(now, village.timeZone, calendar);
    const block = presenceOf(this.db, village.id, c, gt).block;
    const lookingForPlayer = block.intent && block.withIds?.includes(PLAYER_ID);
    const opening = lookingForPlayer
      ? `你本来就是来找抄写员的，想${block.intent}。这会儿抄写员就在跟前。`
      : "抄写员走过来，像是要跟你说话。";
    const dossier = buildDossier(this.db, village, c, now, [], opening);
    const id = randomUUID();
    this.db
      .insert(t.conversations)
      .values({
        id,
        villageId: village.id,
        characterId: c.id,
        locationId: village.playerLocationId,
        startedAt: now,
        transcript: [],
        situation: dossier.situation,
        recalledMemoryIds: dossier.recalled.map((m) => m.id),
      })
      .run();
    markRecalled(this.db, dossier.recalled.map((m) => m.id), now);
    emit({ type: "start", conversationId: id, characterId: c.id, name: c.shortName });

    await this.reply(village, id, [{ speaker: "scene", text: opening, at: now }], emit);
  }

  async say(village: Village, id: string, text: string, emit: Emit): Promise<void> {
    const conv = this.get(id);
    if (!conv || conv.villageId !== village.id || conv.endedAt) return emit({ type: "error", message: "这段话已经说完了。" });
    const clean = text.trim().slice(0, MAX_PLAYER_CHARS);
    if (!clean) return emit({ type: "error", message: "你什么也没说。" });

    const now = this.clock.now();
    const c = getCharacter(this.db, village.id, conv.characterId)!;
    const ok = availability(this.db, village, c, now, conv.locationId);
    if (!ok.ok || village.playerLocationId !== conv.locationId) {
      await this.end(village, id, "time", emit, { text: `${c.shortName}已经走开了。` });
      return;
    }
    if (conv.transcript.filter((l) => l.speaker === PLAYER_ID).length >= MAX_TURNS) {
      return emit({ type: "error", message: `${c.shortName}看样子不想再说下去了。` });
    }
    await this.reply(village, id, [{ speaker: PLAYER_ID, text: clean, at: now }], emit);
  }

  /** The player reads a letter out loud. What they read is up to them; the listener can't check. */
  async readLetter(village: Village, id: string, documentId: string, readAloud: string, emit: Emit): Promise<void> {
    const conv = this.get(id);
    const doc = getDocument(this.db, village.id, documentId);
    if (!conv || conv.endedAt || !doc) return emit({ type: "error", message: "没有这封信。" });
    if (doc.commissionedBy !== conv.characterId) return emit({ type: "error", message: "这封信不是给这个人的。" });
    const text = readAloud.trim().slice(0, 4000);
    if (!text) return emit({ type: "error", message: "你什么也没念。" });
    const now = this.clock.now();
    markRead(this.db, doc, text, now);
    const what = doc.replyToId ? "那封回信" : `这份${KIND_NAMES[doc.kind]}`;
    await this.reply(village, id, [{ speaker: PLAYER_ID, text: `*展开${what}，一字一句念给你听*「${text}」`, at: now }], emit);
  }

  /** Append lines, ask the resident for their answer, carry out their actions. */
  private async reply(village: Village, id: string, incoming: t.TranscriptLine[], emit: Emit): Promise<void> {
    if (this.inFlight.has(id)) return emit({ type: "error", message: "等对方把话说完。" });
    this.inFlight.add(id);
    try {
      const conv = this.get(id)!;
      const c = getCharacter(this.db, village.id, conv.characterId)!;
      const transcript = [...conv.transcript, ...incoming];
      this.save(id, transcript);

      let result;
      try {
        result = await this.gateway.call({
          tier: "dialogue",
          purpose: `dialogue.${c.id}`,
          villageId: village.id,
          system: [...stableSystem(c), { text: conv.situation }],
          messages: toMessages(transcript),
          maxTokens: 3000,
          effort: "low",
          tools: this.story?.active(village) ? [...TOOLS, TIME_TOOL] : TOOLS,
          cacheKey: `elmsford.dialogue.${village.id}.${c.id}`,
          onText: (delta) => emit({ type: "text", delta }),
        });
      } catch (err) {
        // Put things back as they were, so the player can simply try again.
        if (conv.transcript.length) this.save(id, conv.transcript);
        else this.db.delete(t.conversations).where(eq(t.conversations.id, id)).run();
        console.error(`dialogue with ${c.id} failed:`, err instanceof LlmError ? `${err.kind}: ${err.message}` : err);
        emit({ type: "error", message: `${c.shortName}没接话。` });
        return;
      }

      const now = this.clock.now();
      const said = result.refused ? "*没说话*" : result.text.trim();
      if (said) transcript.push({ speaker: c.id, text: said, at: now });

      let leaving: string | null = null;
      let doing = 0;
      for (const call of result.toolCalls) {
        const outcome = this.act(village, c, conv, call, now);
        if (outcome.narration) {
          transcript.push({ speaker: "narration", text: outcome.narration, at: now });
          emit({ type: "action", text: outcome.narration });
        }
        if (outcome.leave) leaving = outcome.leave;
        if (outcome.minutes) doing += outcome.minutes;
      }

      // Story mode: the talk took a while, and whatever they did together longer.
      if (this.story?.active(village)) {
        const spoken = incoming.filter((l) => l.speaker === PLAYER_ID).map((l) => l.text);
        doing = Math.min(doing, storyDay.maxDoingMinutes);
        const passed = this.story.pass(village, talkMinutes(...spoken, said) + doing);
        const around = [
          ...(doing ? [passedText(doing)] : []),
          ...passed.bells.map((b) => `${calendar.bellNames[b]}响了。`),
          ...(passed.night ? ["天黑透了。"] : []),
        ];
        for (const text of around) {
          transcript.push({ speaker: "scene", text, at: this.clock.now() });
          emit({ type: "scene", text });
        }
      }
      this.save(id, transcript);

      if (leaving !== null) await this.end(village, id, "character", emit, { text: `${c.shortName}走了。` });
      emit({ type: "done" });
    } finally {
      this.inFlight.delete(id);
    }
  }

  private act(village: Village, c: CharacterRow, conv: ConversationRow, call: ToolCall, now: number): { narration?: string; leave?: string; minutes?: number } {
    if (call.name === "give") {
      const input = GiveInput.safeParse(call.input);
      if (!input.success) return {};
      const { item, quantity, pence } = input.data;
      const delta = emptyDelta();
      if (pence && pence > 0) delta.transfers.push({ from: c.id, to: PLAYER_ID, pence });
      else if (item) delta.transfers.push({ from: c.id, to: PLAYER_ID, item, quantity: quantity ?? 1 });
      const r = validateAndApply(this.db, delta, {
        villageId: village.id,
        now,
        source: `conversation:${conv.id}:give`,
        participants: [c.id, PLAYER_ID],
        utterances: {},
        limits: CONVERSATION_LIMITS,
        locationId: conv.locationId,
      });
      const done = r.applied.transfers[0];
      if (!done) return {};
      const what = done.pence ? `${done.pence} 便士` : done.quantity && done.quantity > 1 ? `${done.item}×${done.quantity}` : done.item;
      return { narration: `${c.shortName}给了你${what}` };
    }

    if (call.name === "ask_to_write") {
      const input = AskInput.safeParse(call.input);
      if (!input.success || input.data.gist.trim().length < 2) return {};
      const { kind, recipient, gist } = input.data;
      const docId = randomUUID();
      this.db
        .insert(t.documents)
        .values({
          id: docId,
          villageId: village.id,
          kind,
          commissionedBy: c.id,
          dictated: "",
          written: "",
          recipient: recipient ?? null,
          status: "draft",
          createdAt: now,
          gist: gist.trim().slice(0, 300),
        })
        .run();
      logEvent(this.db, village.id, now, "commission", { documentId: docId, by: c.id, kind, recipient, gist }, [c.id, PLAYER_ID]);
      const kindName = { letter: "一封信", contract: "一份契约", will: "一份遗嘱", record: "一份记录" }[kind];
      return { narration: `${c.shortName}托你写${kindName}${recipient ? `，给${recipient}` : ""}。` };
    }

    if (call.name === "leave") {
      const input = LeaveInput.safeParse(call.input);
      return { leave: input.success ? input.data.reason : "" };
    }

    if (call.name === "time_passes") {
      const input = TimeInput.safeParse(call.input);
      return input.success && input.data.minutes > 0 ? { minutes: input.data.minutes } : {};
    }
    return {};
  }

  private save(id: string, transcript: t.TranscriptLine[]) {
    this.db.update(t.conversations).set({ transcript }).where(eq(t.conversations.id, id)).run();
  }

  async end(village: Village, id: string, by: "player" | "character" | "time", emit?: Emit, opts: { text?: string; quiet?: boolean } = {}) {
    const conv = this.get(id);
    if (!conv || conv.endedAt) return;
    const now = this.clock.now();
    this.db.update(t.conversations).set({ endedAt: now, endedBy: by, extraction: "pending" }).where(eq(t.conversations.id, id)).run();
    if (by === "character") markBusy(this.db, village.id, conv.characterId, now + BUSY_AFTER_LEAVING);
    if (!opts.quiet) emit?.({ type: "end", by, ...(opts.text ? { text: opts.text } : {}) });
    logEvent(this.db, village.id, now, "conversation", { conversationId: id, characterId: conv.characterId, endedBy: by }, [conv.characterId, PLAYER_ID]);
    void this.extract(village, id);
    // Talked into the night: once it's over, home to bed.
    this.story?.settle(village);
  }

  private async extract(village: Village, id: string) {
    try {
      await extractConversation(this.db, this.gateway, village, id);
    } catch (err) {
      console.error(`extraction failed for ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  /** At startup: extractions cut off by the last shutdown are tried again by the sweep. */
  resume() {
    this.db.update(t.conversations).set({ extraction: "failed" }).where(eq(t.conversations.extraction, "pending")).run();
  }

  /** End idle conversations and retry failed extractions. Called periodically. */
  async sweep(villageId: string) {
    const village = getVillage(this.db, villageId);
    if (!village) return;
    const now = this.clock.now();
    for (const conv of this.db.select().from(t.conversations).where(and(eq(t.conversations.villageId, villageId), isNull(t.conversations.endedAt))).all()) {
      const lastAt = conv.transcript.at(-1)?.at ?? conv.startedAt;
      if (now - lastAt > IDLE_TIMEOUT && !this.inFlight.has(conv.id)) await this.end(village, conv.id, "time");
    }
    const stuck = this.db
      .select()
      .from(t.conversations)
      .where(and(eq(t.conversations.villageId, villageId), eq(t.conversations.extraction, "failed"), lt(t.conversations.endedAt, now - MINUTE)))
      .all();
    for (const conv of stuck.slice(0, 2)) await this.extract(village, conv.id);
  }
}
