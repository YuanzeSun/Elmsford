import { calendar, folk, inSeason, locations, MENTION_WINDOW_DAYS, openings } from "@elmsford/content";
import { computeGameTime, zonedToInstant } from "@elmsford/core";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { LOCAL_VILLAGE_ID } from "../config";
import * as t from "../db/schema";
import { simPlayerStatus, startSimPlayer, stopSimPlayer } from "../dev/simPlayer";
import { judgeStyle } from "../dev/styleJudge";
import { importSave, type SaveFile } from "../save";
import { startOfDate } from "../sim/days";
import { getNewcomers, mentionCounts, queueNewcomer } from "../sim/newcomers";
import { LlmError } from "../llm/gateway";
import { getVillage } from "../village";
import { getResidents } from "../world/repo";
import { body, type Services } from "./util";

const ClockBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("real") }),
  z.object({ action: z.literal("speed"), speed: z.number().min(0).max(86_400) }),
  /** Local wall-clock time in the village's zone, "YYYY-MM-DDTHH:MM". */
  z.object({ action: z.literal("jump"), local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }),
]);

const StyleJudgeBody = z.object({ text: z.string().min(1).max(4000) });

const SimPlayerBody = z.object({
  days: z.number().int().min(1).max(60),
  talk: z.boolean(),
  turns: z.number().int().min(1).max(8),
});


/** Dev tools (技术设计 §6). Mounted only in dev mode. */
export function devRoutes(s: Services) {
  const { db, clock, gateway, sim, conversations } = s;
  const dev = new Hono();

  dev.post("/save/import", async (c) => {
    const save = (await c.req.json().catch(() => null)) as SaveFile | null;
    if (!save) return c.json({ error: "不是 JSON" }, 400);
    try {
      importSave(db, LOCAL_VILLAGE_ID, save);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
    return c.json({ ok: true });
  });

  dev.get("/sim", (c) => c.json({ status: sim.status(LOCAL_VILLAGE_ID), player: simPlayerStatus() }));

  dev.post("/sim/player", async (c) => {
    const b = await body(c, SimPlayerBody);
    if (b instanceof Response) return b;
    if (!getVillage(db, LOCAL_VILLAGE_ID)) return c.json({ error: "no village yet" }, 409);
    return c.json(startSimPlayer({ db, clock, gateway, sim, conversations }, LOCAL_VILLAGE_ID, b));
  });

  dev.post("/sim/player/stop", (c) => {
    stopSimPlayer();
    return c.json({ ok: true });
  });

  /** Per-day pulse of the village (M4: neither a stagnant pond nor a soap opera). */
  dev.get("/pulse", (c) => {
    const v = LOCAL_VILLAGE_ID;
    const days = db.select().from(t.villageDays).where(eq(t.villageDays.villageId, v)).orderBy(desc(t.villageDays.date)).limit(60).all();
    const village = getVillage(db, v);
    if (!village) return c.json([]);
    const mems = db.select().from(t.memories).where(eq(t.memories.villageId, v)).all();
    const events = db.select().from(t.worldEvents).where(eq(t.worldEvents.villageId, v)).all();
    const residents = getResidents(db, v).length || 1;
    return c.json(
      days.map((d) => {
        const start = startOfDate(village, d.date);
        const end = start + 86_400_000;
        const inDay = <T extends { at: number }>(xs: T[]) => xs.filter((x) => x.at >= start && x.at < end);
        const dayMems = inDay(mems).filter((m) => m.kind === "event");
        const important = dayMems.filter((m) => m.importance >= 6).length;
        const pub = inDay(events).filter((e) => e.type === "public").length;
        const intensity = (important + pub) / residents;
        return {
          date: d.date,
          weather: d.weather.text,
          calm: d.calm,
          mode: d.mode,
          happenings: d.happenings.map((h) => h.text),
          memories: dayMems.length,
          important,
          publicEvents: pub,
          flag: dayMems.length === 0 && d.settled ? "stagnant" : intensity > 1.2 ? "soap" : null,
        };
      }),
    );
  });


  dev.get("/clock", (c) => c.json(clock.info()));

  dev.post("/clock", async (c) => {
    const b = await body(c, ClockBody);
    if (b instanceof Response) return b;
    const village = getVillage(db, LOCAL_VILLAGE_ID);
    let info;
    if (b.action === "real") info = clock.useRealTime();
    else if (b.action === "speed") info = clock.adjust({ speed: b.speed });
    else {
      if (!village) return c.json({ error: "no village yet" }, 409);
      const [date, time] = b.local.split("T") as [string, string];
      const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
      const [h, mi] = time.split(":").map(Number) as [number, number];
      info = clock.adjust({ jumpTo: zonedToInstant(y, mo, d, h, mi, village.timeZone) });
    }
    // Don't wait for the next tick: catch the village up to the new time now.
    if (village) void sim.advance(village.id);
    return c.json(info);
  });

  dev.get("/world", (c) => {
    const v = LOCAL_VILLAGE_ID;
    return c.json({
      village: getVillage(db, v) ?? null,
      characters: db.select().from(t.characters).where(eq(t.characters.villageId, v)).all(),
      relationships: db.select().from(t.relationships).where(eq(t.relationships.villageId, v)).all(),
      facts: db.select().from(t.facts).where(eq(t.facts.villageId, v)).all(),
      memories: db.select().from(t.memories).where(eq(t.memories.villageId, v)).orderBy(desc(t.memories.at)).limit(200).all(),
      commitments: db.select().from(t.commitments).where(eq(t.commitments.villageId, v)).all(),
      dayPlans: db.select().from(t.dayPlans).where(eq(t.dayPlans.villageId, v)).orderBy(desc(t.dayPlans.date)).limit(50).all(),
      documents: db.select().from(t.documents).where(eq(t.documents.villageId, v)).all(),
      events: db.select().from(t.worldEvents).where(eq(t.worldEvents.villageId, v)).orderBy(desc(t.worldEvents.at)).limit(100).all(),
      conversations: db.select().from(t.conversations).where(eq(t.conversations.villageId, v)).orderBy(desc(t.conversations.startedAt)).limit(30).all(),
      inventory: db.select().from(t.inventory).where(eq(t.inventory.villageId, v)).all(),
      notebook: db.select().from(t.notebook).where(eq(t.notebook.villageId, v)).all(),
      rejections: db.select().from(t.rejections).where(eq(t.rejections.villageId, v)).orderBy(desc(t.rejections.at)).limit(100).all(),
      factKnowledge: db
        .select({ factId: t.factKnowledge.factId, characterId: t.factKnowledge.characterId, belief: t.factKnowledge.belief, source: t.factKnowledge.source })
        .from(t.factKnowledge)
        .innerJoin(t.facts, eq(t.facts.id, t.factKnowledge.factId))
        .where(eq(t.facts.villageId, v))
        .all(),
      remotePeople: db.select().from(t.remotePeople).where(eq(t.remotePeople.villageId, v)).all(),
      personaNotes: db.select().from(t.personaNotes).where(eq(t.personaNotes.villageId, v)).all(),
      lore: db.select().from(t.lore).where(eq(t.lore.villageId, v)).all(),
      locations,
      ...people(v),
    });
  });

  /** The folk and who might come: how often each villager comes up, who's in season. */
  const people = (v: string) => {
    const now = clock.now();
    const village = getVillage(db, v);
    const counts = mentionCounts(db, v, now - MENTION_WINDOW_DAYS * 86_400_000, now);
    const date = village ? computeGameTime(now, village.timeZone, calendar).date : "";
    return {
      folk: folk.map((f) => ({ id: f.id, shortName: f.shortName, occupation: f.occupation, mentions: counts.get(f.id) ?? 0 })),
      openings: openings.map((o) => ({ id: o.id, occupation: o.occupation, inSeason: inSeason(o, date) })),
      newcomers: getNewcomers(db, v),
    };
  };

  const NewcomerBody = z.object({ kind: z.enum(["folk", "arrival"]), id: z.string() });

  /** Bring someone in now, without waiting for the rule (dev only). */
  dev.post("/newcomer", async (c) => {
    const b = await body(c, NewcomerBody);
    if (b instanceof Response) return b;
    const known = b.kind === "folk" ? folk.some((f) => f.id === b.id) : openings.some((o) => o.id === b.id);
    if (!known) return c.json({ error: "unknown" }, 400);
    const now = clock.now();
    const row = queueNewcomer(db, LOCAL_VILLAGE_ID, b.kind, b.id, now, now);
    if (!row) return c.json({ error: "busy" }, 409);
    void sim.advance(LOCAL_VILLAGE_ID);
    return c.json(row);
  });

  dev.get("/llm/calls", (c) => {
    const limit = Math.min(200, Number(c.req.query("limit")) || 50);
    const rows = db
      .select({
        id: t.llmCalls.id,
        startedAt: t.llmCalls.startedAt,
        gameDate: t.llmCalls.gameDate,
        purpose: t.llmCalls.purpose,
        tierRequested: t.llmCalls.tierRequested,
        tierUsed: t.llmCalls.tierUsed,
        provider: t.llmCalls.provider,
        model: t.llmCalls.model,
        status: t.llmCalls.status,
        inputTokens: t.llmCalls.inputTokens,
        outputTokens: t.llmCalls.outputTokens,
        cacheReadTokens: t.llmCalls.cacheReadTokens,
        cacheWriteTokens: t.llmCalls.cacheWriteTokens,
        costUsd: t.llmCalls.costUsd,
        durationMs: t.llmCalls.durationMs,
        error: t.llmCalls.error,
      })
      .from(t.llmCalls)
      .orderBy(desc(t.llmCalls.startedAt))
      .limit(limit)
      .all();
    return c.json(rows);
  });

  dev.get("/llm/calls/:id", (c) => {
    const row = db.select().from(t.llmCalls).where(eq(t.llmCalls.id, c.req.param("id"))).get();
    return row ? c.json(row) : c.notFound();
  });

  dev.post("/style-judge", async (c) => {
    const b = await body(c, StyleJudgeBody);
    if (b instanceof Response) return b;
    try {
      const r = await judgeStyle(gateway, b.text, LOCAL_VILLAGE_ID);
      return c.json({ verdict: r.data, model: r.model, provider: r.provider, usage: r.usage, costUsd: r.costUsd, durationMs: r.durationMs });
    } catch (err) {
      if (err instanceof LlmError) return c.json({ error: err.message, kind: err.kind, callId: err.callId }, 502);
      throw err;
    }
  });

  return dev;
}
