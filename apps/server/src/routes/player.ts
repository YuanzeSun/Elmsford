import { calendar, DRAW_MAPS, intro, introHint, storyDay, timeModes } from "@elmsford/content";
import { computeGameTime, describeTime, isValidTimeZone, nextStorySegment, PLAYER_ID, storySegmentAt } from "@elmsford/core";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LOCAL_VILLAGE_ID } from "../config";
import type { Emit, StreamEvent } from "../conversation/service";
import * as t from "../db/schema";
import { availability } from "../conversation/context";
import { dictate, FEES, getDocument, listDocuments, saveWritten, seal } from "../scribe/letters";
import { ensureDay } from "../sim/days";
import { recentOverheard } from "../sim/encounters";
import { latestUnseenRecap } from "../sim/recap";
import { talkMinutes } from "../sim/story";
import type { Db } from "../db/client";
import { deleteVillage, exportSave } from "../save";
import { ensureVillage, getVillage, startVillage, type Village } from "../village";
import { heardDays, heardInHeadline } from "../world/lore";
import { mapFor } from "../world/map";
import { movePlayer, pickUp, placeView } from "../world/place";
import { describeInventory, formatPence, getCharacters, getInventory, getPlayerMoney } from "../world/repo";
import { body, village, type Services } from "./util";

const SessionBody = z.object({ timeZone: z.string().refine(isValidTimeZone, "unknown time zone") });
const MoveBody = z.object({ to: z.string().min(1) });
const TalkBody = z.object({ characterId: z.string().min(1) });
const SayBody = z.object({ text: z.string().min(1).max(2000) });
const NoteBody = z.object({ characterId: z.string().min(1), text: z.string().min(1).max(500) });
const ReadBody = z.object({ documentId: z.string().min(1), text: z.string().min(1).max(8000) });
const WriteBody = z.object({ written: z.string().max(8000) });
const StartBody = z.object({ mode: z.enum(["story", "real"]) });
const RestBody = z.object({ until: z.enum(["segment", "day"]) });

/** Notifications per real day, at most (技术设计 §5: 只在有人找你时发送，并且有每日上限). */
const NOTIFY_DAILY_CAP = 3;

export function playerRoutes(s: Services) {
  const { db, clock, config, conversations, sim, gateway, story } = s;
  const r = new Hono();

  r.post("/session", async (c) => {
    const b = await body(c, SessionBody);
    if (b instanceof Response) return b;
    const v = ensureVillage(db, LOCAL_VILLAGE_ID, b.timeZone, clock.now());
    sim.ping(v.id);
    void sim.advance(v.id);
    return c.json({
      villageId: v.id,
      timeZone: v.timeZone,
      devMode: config.devMode,
      timeMode: v.timeMode,
      intro: v.startedAt ? null : { paragraphs: intro, hint: introHint, modes: timeModes },
    });
  });

  /** Walking in, having chosen how the days go. Only once: it can't be changed later. */
  r.post("/start", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, StartBody);
    if (b instanceof Response) return b;
    if (v.startedAt) return c.json({ ok: true, timeMode: v.timeMode });
    const started = startVillage(db, v.id, b.mode, clock.outside());
    sim.ping(started.id);
    void sim.advance(started.id);
    return c.json({ ok: true, timeMode: started.timeMode });
  });

  /** Leaving the village (离开…): this village is gone for good; the next session moves you into a new one. */
  r.post("/leave", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    await sim.settle(v.id);
    db.transaction((tx) => deleteVillage(tx as unknown as Db, v.id));
    sim.forget(v.id);
    return c.json({ ok: true });
  });

  r.get("/map", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    // Final once no other drawing is coming: the village has its own, or drawing is off.
    return c.json({ ...mapFor(v), final: Boolean(v.map) || !DRAW_MAPS });
  });

  r.get("/now", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const before = latestUnseenRecap(db, v.id)?.id;
    sim.ping(v.id);
    const recapId = latestUnseenRecap(db, v.id)?.id ?? null;
    if (recapId && recapId !== before) void sim.advance(v.id);
    const gameTime = computeGameTime(clock.now(), v.timeZone, calendar);
    const info = clock.info();
    const day = ensureDay(db, v, gameTime.date);
    const segment = story.active(v) ? storySegmentAt(storyDay.segments, gameTime.minuteOfDay) : null;
    return c.json({
      story: segment ? { segment: segment.id, name: segment.name, next: nextStorySegment(storyDay.segments, segment)?.name ?? null } : null,
      weather: day.weather,
      heard: heardInHeadline(db, v.id, gameTime),
      sim: sim.status(v.id),
      recapId,
      gameTime,
      text: describeTime(gameTime, calendar),
      clock: info,
      // A sped-up dev clock needs frequent refreshes; real time barely changes in 15 s.
      pollMs: info.mode === "fake" && info.speed > 1 ? 1000 : 15_000,
    });
  });

  const look = (before: Village) => {
    // Story mode: past the evening, the player is in bed by now.
    story.settle(before);
    const v = getVillage(db, before.id)!;
    const now = clock.now();
    const view = placeView(db, v, now);
    if (view.people.filter((p) => p.activity !== "睡着了").length >= 2 && !conversations.active(v.id)) void sim.listen(v.id, v.playerLocationId);
    return { ...view, overheard: recentOverheard(db, v, v.playerLocationId, now), note: story.takeNote() };
  };

  r.get("/place", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    return c.json(look(v));
  });

  r.post("/move", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, MoveBody);
    if (b instanceof Response) return b;
    const active = conversations.active(v.id);
    const result = movePlayer(db, v, b.to, clock.now());
    if (!result.ok) return c.json(result);
    if (active) await conversations.end(v, active.id, "player");
    story.pass(v, storyDay.walkMinutes);
    return c.json({ ok: true, place: look(getVillage(db, v.id)!) });
  });

  /** Story mode: rest here until the next part of the day, or let the rest of today go. */
  r.post("/rest", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, RestBody);
    if (b instanceof Response) return b;
    if (!story.active(v)) return c.json({ error: "日子跟着日头走。" }, 409);
    const active = conversations.active(v.id);
    if (active) await conversations.end(v, active.id, "player");
    story.rest(getVillage(db, v.id)!, b.until);
    return c.json({ ok: true, place: look(getVillage(db, v.id)!) });
  });

  r.post("/pickup", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    return c.json({ picked: pickUp(db, v) });
  });

  r.get("/me", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const money = getPlayerMoney(db, v.id);
    return c.json({ money, moneyText: formatPence(money), inventory: describeInventory(getInventory(db, v.id, PLAYER_ID)) });
  });

  // ---- conversation ----

  const sse = (c: Context, run: (emit: Emit) => Promise<void>) =>
    streamSSE(c, async (stream) => {
      const writes: Promise<unknown>[] = [];
      const emit: Emit = (e: StreamEvent) => {
        writes.push(stream.writeSSE({ event: e.type, data: JSON.stringify(e) }));
      };
      try {
        await run(emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      await Promise.all(writes);
    });

  r.post("/talk", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, TalkBody);
    if (b instanceof Response) return b;
    return sse(c, (emit) => conversations.start(v, b.characterId, emit));
  });

  r.post("/talk/:id/say", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, SayBody);
    if (b instanceof Response) return b;
    const id = c.req.param("id");
    return sse(c, (emit) => conversations.say(v, id, b.text, emit));
  });

  r.post("/talk/:id/read", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, ReadBody);
    if (b instanceof Response) return b;
    const id = c.req.param("id");
    return sse(c, (emit) => conversations.readLetter(v, id, b.documentId, b.text, emit));
  });

  r.post("/talk/:id/leave", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    await conversations.end(v, c.req.param("id"), "player");
    return c.json({ ok: true });
  });

  r.get("/talk/active", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const conv = conversations.active(v.id);
    if (!conv) return c.json(null);
    const who = getCharacters(db, v.id).find((x) => x.id === conv.characterId);
    return c.json({ id: conv.id, characterId: conv.characterId, name: who?.shortName ?? conv.characterId, transcript: conv.transcript });
  });

  // ---- 这几天 ----

  r.get("/recap", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const recap = latestUnseenRecap(db, v.id);
    return c.json({ recap: recap ?? null, sim: sim.status(v.id) });
  });

  r.post("/recap/:id/seen", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    db.update(t.recaps).set({ seenAt: clock.now() }).where(and(eq(t.recaps.villageId, v.id), eq(t.recaps.id, c.req.param("id")))).run();
    return c.json({ ok: true });
  });

  // ---- the desk ----

  r.get("/desk", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const now = clock.now();
    const people = getCharacters(db, v.id);
    const docs = listDocuments(db, v.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((d) => {
        const who = people.find((p) => p.id === d.commissionedBy);
        const here = who ? availability(db, v, who, now, v.playerLocationId) : { ok: false as const, reason: "" };
        return {
          ...d,
          commissionerName: who?.shortName ?? d.commissionedBy,
          canDictate: !d.sealedAt && !d.replyToId && here.ok,
          fee: FEES[d.kind],
        };
      });
    return c.json(docs);
  });

  r.post("/desk/:id/dictate", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const doc = getDocument(db, v.id, c.req.param("id"));
    if (!doc) return c.json({ error: "没有这份东西" }, 404);
    const who = getCharacters(db, v.id).find((p) => p.id === doc.commissionedBy);
    const here = who ? availability(db, v, who, clock.now(), v.playerLocationId) : { ok: false as const, reason: "委托人不在了" };
    if (!here.ok) return c.json({ error: here.reason }, 409);
    return sse(c, async (emit) => {
      emit({ type: "start", conversationId: doc.id, characterId: doc.commissionedBy, name: who!.shortName });
      try {
        let said = "";
        await dictate(db, gateway, v, doc, clock.now(), (delta) => {
          said += delta;
          emit({ type: "text", delta });
        });
        story.pass(v, talkMinutes(said));
        emit({ type: "done" });
      } catch (err) {
        console.error(`dictation for ${doc.id} failed:`, err instanceof Error ? err.message : err);
        emit({ type: "error", message: `${who!.shortName}没说下去。` });
      }
    });
  });

  r.post("/desk/:id/write", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, WriteBody);
    if (b instanceof Response) return b;
    const doc = getDocument(db, v.id, c.req.param("id"));
    if (!doc) return c.json({ error: "没有这份东西" }, 404);
    if (v.playerLocationId !== "player_house") return c.json({ error: "你不在屋里。" }, 409);
    try {
      saveWritten(db, doc, b.written);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
    // Story mode: a quill is slow. Only what's new counts; going over it again is quick.
    const added = b.written.replace(/\s/g, "").length - doc.written.replace(/\s/g, "").length;
    if (added > 0) story.pass(v, Math.ceil(added / storyDay.writeCharsPerMinute));
    story.settle(getVillage(db, v.id)!);
    return c.json({ ok: true });
  });

  r.post("/desk/:id/seal", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const doc = getDocument(db, v.id, c.req.param("id"));
    if (!doc) return c.json({ error: "没有这份东西" }, 404);
    if (v.playerLocationId !== "player_house") return c.json({ error: "你不在屋里。" }, 409);
    try {
      return c.json(seal(db, v, doc, clock.now()));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
  });

  // ---- notifications ----

  r.get("/notifications", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const since = Date.now() - 86_400_000;
    const deliveredToday = db
      .select()
      .from(t.notifications)
      .where(and(eq(t.notifications.villageId, v.id), isNotNull(t.notifications.deliveredAt)))
      .all()
      .filter((n) => (n.deliveredAt ?? 0) > since).length;
    const pending = db
      .select()
      .from(t.notifications)
      .where(and(eq(t.notifications.villageId, v.id), isNull(t.notifications.deliveredAt)))
      .orderBy(asc(t.notifications.at))
      .all();
    const room = Math.max(0, NOTIFY_DAILY_CAP - deliveredToday);
    const out = pending.slice(-room || pending.length).slice(0, room);
    // Anything over the cap is quietly folded away; the player will find it in the village anyway.
    for (const n of pending) db.update(t.notifications).set({ deliveredAt: Date.now() }).where(eq(t.notifications.id, n.id)).run();
    return c.json(out.map((n) => ({ id: n.id, text: n.text, characterId: n.characterId })));
  });

  // ---- save file ----

  r.get("/save", (c) => {
    const save = exportSave(db, LOCAL_VILLAGE_ID, clock.now());
    if (!save) return c.json({ error: "还没有村子" }, 404);
    const date = new Date().toISOString().slice(0, 10);
    c.header("content-disposition", `attachment; filename="elmsford-${date}.json"`);
    return c.json(save);
  });

  // ---- notebook ----

  r.get("/notebook/days", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    return c.json(heardDays(db, v.id));
  });

  r.get("/notebook", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const notes = db.select().from(t.notebook).where(eq(t.notebook.villageId, v.id)).orderBy(asc(t.notebook.at)).all();
    const people = getCharacters(db, v.id).map((ch) => ({
      id: ch.id,
      name: ch.name,
      status: ch.status,
      notes: notes.filter((n) => n.characterId === ch.id).map((n) => ({ id: n.id, at: n.at, text: n.text, byPlayer: n.byPlayer })),
      metAt:
        db
          .select({ at: t.conversations.startedAt })
          .from(t.conversations)
          .where(and(eq(t.conversations.villageId, v.id), eq(t.conversations.characterId, ch.id)))
          .orderBy(asc(t.conversations.startedAt))
          .get()?.at ?? null,
    }));
    return c.json(people);
  });

  r.post("/notebook", async (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const b = await body(c, NoteBody);
    if (b instanceof Response) return b;
    db.insert(t.notebook).values({ id: randomUUID(), villageId: v.id, characterId: b.characterId, at: clock.now(), text: b.text.trim(), byPlayer: true }).run();
    return c.json({ ok: true });
  });

  // Only lines the player wrote can be crossed out; what was noted on its own stays.
  r.delete("/notebook/:id", (c) => {
    const v = village(c, db);
    if (v instanceof Response) return v;
    const removed = db
      .delete(t.notebook)
      .where(and(eq(t.notebook.villageId, v.id), eq(t.notebook.id, c.req.param("id")), eq(t.notebook.byPlayer, true)))
      .run();
    return removed.changes ? c.json({ ok: true }) : c.json({ error: "没有这一条" }, 404);
  });

  return r;
}
