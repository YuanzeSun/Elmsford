import { PLAYER_ID, routineForDay, computeGameTime, zonedToInstant } from "@elmsford/core";
import { calendar, routines } from "@elmsford/content";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db/client";
import * as t from "../src/db/schema";
import { LlmGateway } from "../src/llm/gateway";
import type { Provider, ProviderCall, ProviderResult } from "../src/llm/types";
import { dispatchLetters, deliverReplies, seal } from "../src/scribe/letters";
import { ensureDay, settleDay } from "../src/sim/days";
import { Simulation } from "../src/sim/engine";
import { findEncounters, resolveEncounters } from "../src/sim/encounters";
import { repairPlan } from "../src/sim/planner";
import { latestUnseenRecap, startRecap } from "../src/sim/recap";
import { ensureVillage, getVillage, startVillage } from "../src/village";
import { getCharacter, getInventory } from "../src/world/repo";

const TZ = "Asia/Shanghai";
const DAY = 86_400_000;

const SUMMARY = {
  days: [{ characterId: "matilda", text: "玛蒂尔达照常酿酒卖酒。" }],
  memories: [{ characterId: "hubert", text: "休伯特在酒馆里跟玛蒂尔达斗了半天嘴", importance: 3, participants: ["matilda"] }],
  shared: [],
  news: [{ tellerId: "thomas", hearerId: "joan", text: "托马斯说水轮轴裂了，管家不肯拨钱" }],
  relationships: [{ from: "hubert", to: "matilda", trustDelta: 1, affectionDelta: 0 }],
  concerns: [],
  public: ["托马斯和瓦特在磨坊门口吵了一架"],
  forPlayer: [{ characterId: "joan", item: "鸡蛋", qty: 2, message: "给你的，别客气" }],
  moods: [{ characterId: "joan", mood: "高兴" }],
};

function setup(start = zonedToInstant(2026, 10, 20, 10, 0, TZ)) {
  const db = openDb(":memory:");
  let now = start;
  const clock = { now: () => now };
  ensureVillage(db, "local", TZ, now - 30 * DAY); // created a month ago, so the director is awake
  startVillage(db, "local", "real", now - 30 * DAY);
  // These tests are about the clock; the map is drawn elsewhere (map.test.ts).
  db.update(t.villages).set({ map: { rows: ["."], labels: [] } }).run();
  const calls: ProviderCall[] = [];
  const provider: Provider = {
    async listModels() {
      return [];
    },
    async call(c) {
      calls.push(c);
      const name = c.json?.name;
      const text =
        name === "village_summary"
          ? JSON.stringify(SUMMARY)
          : name === "day_plans"
            ? JSON.stringify({ residents: [] })
            : name === "encounters"
              ? JSON.stringify({
                  encounters: [
                    {
                      id: "E1",
                      summary: "琼来敲门，没人应，把两个鸡蛋放在门口。",
                      memories: [],
                      shared: [],
                      news: [],
                      relationships: [],
                      concerns: [],
                      public: null,
                      overheard: [],
                      leftForPlayer: { item: "鸡蛋", qty: 2, message: "改天再来" },
                    },
                  ],
                })
              : name === "remote_person"
                ? JSON.stringify({ name: "沃尔特·格林", relation: "休伯特的弟弟", place: "北边约克郡的一个村子", alive: false, description: "三年前死了。他儿子还在。" })
                : name === "reflection"
                  ? JSON.stringify({ residents: [] })
                  : "你离开了几天。门口放着两个鸡蛋。";
      return { text, toolCalls: [], model: c.model, usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", refused: false } satisfies ProviderResult;
    },
  };
  const creds = { anthropic: { file: "x", baseURL: null, apiKey: "k", authToken: null, models: {} }, openai: null, notes: [] };
  const config = { ...loadConfig({}), villageDailyBudgetUsd: 100, globalDailyCapUsd: 100 };
  const gateway = new LlmGateway({ db, clock, config, credentials: { get: () => creds }, providerFactory: () => provider });
  const sim = new Simulation(db, clock, gateway);
  return { db, sim, gateway, calls, village: () => getVillage(db, "local")!, setNow: (x: number) => (now = x), now: () => now };
}

describe("plan repair", () => {
  it("keeps valid waking blocks, drops nonsense, fills gaps from the routine", () => {
    const gt = computeGameTime(zonedToInstant(2026, 10, 20, 12, 0, TZ), TZ, calendar);
    const routine = routineForDay(routines.joan!, gt, { locationId: "atwood_cottage", activity: "在家" });
    const blocks = repairPlan(
      [
        { from: "09:00", to: "11:00", locationId: "mill", activity: "去磨坊扛面袋", withIds: ["thomas", "nobody"], intent: null },
        { from: "10:00", to: "12:00", locationId: "green", activity: "重叠的", withIds: [], intent: null },
        { from: "13:00", to: "14:00", locationId: "atlantis", activity: "不存在的地方", withIds: [], intent: null },
        { from: "15:00", to: "16:00", locationId: "player_house", activity: "去找抄写员", withIds: ["player"], intent: "托他给邻村那人回个话" },
      ],
      routine,
      new Set(["thomas", "joan"]),
    );
    expect(blocks[0]!.from).toBe("00:00");
    expect(blocks.at(-1)!.to).toBe("24:00");
    for (let i = 1; i < blocks.length; i++) expect(blocks[i]!.from).toBe(blocks[i - 1]!.to);
    expect(blocks.find((b) => b.activity === "去磨坊扛面袋")!.withIds).toEqual(["thomas"]);
    expect(blocks.some((b) => b.activity === "重叠的" || b.locationId === "atlantis")).toBe(false);
    expect(blocks.find((b) => b.locationId === "player_house")!.intent).toBe("托他给邻村那人回个话");
    expect(blocks.filter((b) => b.asleep).length).toBeGreaterThanOrEqual(2);
  });
});

describe("catch-up", () => {
  it("summarizes days the player missed, settles them, and writes 这几天", async () => {
    const s = setup();
    await s.sim.advance("local"); // first run just starts the clock
    expect(s.village().simulatedUntil).toBe(s.now());

    const leftAt = s.now();
    s.setNow(leftAt + 3 * DAY + 2 * 3_600_000);
    startRecap(s.db, s.village(), leftAt, s.now());
    await s.sim.advance("local");

    expect(s.village().simulatedUntil).toBeGreaterThan(s.now() - 15 * 60_000);
    const summaries = s.calls.filter((c) => c.json?.name === "village_summary");
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    const days = s.db.select().from(t.villageDays).all();
    expect(days.filter((d) => d.settled).length).toBeGreaterThanOrEqual(2);

    // The validator let the gift through (Joan has eggs) and recorded the news with its teller.
    expect(getInventory(s.db, "local", "loc:player_house").get("鸡蛋")).toBeGreaterThanOrEqual(2);
    const news = s.db.select().from(t.factKnowledge).all().find((k) => k.characterId === "joan" && k.source === "thomas");
    expect(news).toBeDefined();

    const recap = latestUnseenRecap(s.db, "local")!;
    expect(recap.status).toBe("ready");
    expect(recap.text.length).toBeGreaterThan(0);
    expect(s.sim.status("local").running).toBe(false);
  });

  it("is resumable: a second advance after catching up does nothing", async () => {
    const s = setup();
    await s.sim.advance("local");
    s.setNow(s.now() + 2 * DAY);
    await s.sim.advance("local");
    const before = s.calls.length;
    await s.sim.advance("local");
    expect(s.calls.length).toBe(before);
  });
});

describe("visits", () => {
  it("leaves something at the door when nobody answers", async () => {
    const s = setup(zonedToInstant(2026, 10, 20, 15, 0, TZ));
    const v = s.village();
    const date = "2026-10-20";
    ensureDay(s.db, v, date);
    const joan = getCharacter(s.db, "local", "joan")!;
    const routine = routineForDay(routines.joan!, computeGameTime(s.now(), TZ, calendar), { locationId: "atwood_cottage", activity: "在家" });
    const blocks = repairPlan([{ from: "15:00", to: "16:00", locationId: "player_house", activity: "去找抄写员", withIds: [PLAYER_ID], intent: "送两个鸡蛋" }], routine, new Set([joan.id]));
    s.db.insert(t.dayPlans).values({ villageId: "local", characterId: "joan", date, blocks }).run();

    const encounters = findEncounters(s.db, v, zonedToInstant(2026, 10, 20, 15, 0, TZ), { playerAt: null });
    expect(encounters.map((e) => e.kind)).toEqual(["visit"]);
    await resolveEncounters(s.db, s.gateway, v, encounters);
    expect(getInventory(s.db, "local", "loc:player_house").get("鸡蛋")).toBe(2);
    expect(getInventory(s.db, "local", "joan").get("鸡蛋")).toBe(4);
    expect(s.db.select().from(t.notifications).all()[0]!.text).toContain("琼在你门口留了鸡蛋");

    // Same hour again: already resolved.
    expect(findEncounters(s.db, v, zonedToInstant(2026, 10, 20, 15, 0, TZ), { playerAt: null })).toEqual([]);
  });
});

describe("letters", () => {
  it("go out on Thursday and a reply comes back weeks later", async () => {
    const s = setup(zonedToInstant(2026, 10, 22, 19, 0, TZ)); // a Thursday
    const v = s.village();
    s.db.insert(t.documents)
      .values({ id: "d1", villageId: "local", kind: "letter", commissionedBy: "hubert", dictated: "告诉他我还活着。", written: "沃尔特：我是你哥哥休伯特，我还活着，住在 Elmsford。你要是还在，捎个信来。", recipient: "北边的弟弟", status: "draft", createdAt: s.now(), gist: "问弟弟还活着没有" })
      .run();
    const before = getCharacter(s.db, "local", "hubert")!.state.money;
    seal(s.db, v, s.db.select().from(t.documents).where(eq(t.documents.id, "d1")).get()!, s.now());
    expect(getCharacter(s.db, "local", "hubert")!.state.money).toBe(before - 2);

    expect(await dispatchLetters(s.db, s.gateway, v, s.now())).toBe(1);
    const sent = s.db.select().from(t.documents).where(eq(t.documents.id, "d1")).get()!;
    expect(sent.status).toBe("sent");
    const person = s.db.select().from(t.remotePeople).all()[0]!;
    expect(person).toMatchObject({ name: "沃尔特·格林", alive: false, linkedCharacterId: "hubert" });

    if (sent.replyDueAt) {
      expect(await deliverReplies(s.db, s.gateway, v, sent.replyDueAt + DAY)).toBe(1);
      const reply = s.db.select().from(t.documents).where(eq(t.documents.replyToId, "d1")).get()!;
      expect(reply).toMatchObject({ status: "delivered", commissionedBy: "hubert" });
      // The reply answers what was written, and was written on behalf of a dead man's family.
      const replyCall = s.calls.filter((c) => !c.json).at(-1)!;
      expect(replyCall.messages[0]!.content).toContain("我是你哥哥休伯特");
      expect(replyCall.messages[0]!.content).toContain("已经不在了");
    }
  });
});

describe("days", () => {
  it("settles money and health once, and breaks overdue promises to residents", () => {
    const s = setup();
    const v = s.village();
    const due = zonedToInstant(2026, 10, 18, 12, 0, TZ);
    s.db.insert(t.commitments).values({ id: "c1", villageId: "local", byId: PLAYER_ID, toId: "hubert", text: "替他写信", due, status: "open", createdAt: due - DAY }).run();
    const trustBefore = s.db.select().from(t.relationships).where(and(eq(t.relationships.fromId, "hubert"), eq(t.relationships.toId, PLAYER_ID))).get()!.trust;

    settleDay(s.db, v, "2026-10-20");
    settleDay(s.db, v, "2026-10-20"); // idempotent
    expect(s.db.select().from(t.commitments).where(eq(t.commitments.id, "c1")).get()!.status).toBe("broken");
    expect(s.db.select().from(t.relationships).where(and(eq(t.relationships.fromId, "hubert"), eq(t.relationships.toId, PLAYER_ID))).get()!.trust).toBe(trustBefore - 3);
    expect(s.db.select().from(t.memories).all().some((m) => m.characterId === "hubert" && m.text.includes("替他写信"))).toBe(true);
  });

  it("lets the director add a happening when the village has been quiet", () => {
    const s = setup();
    const v = s.village();
    let happened = 0;
    for (let d = 1; d <= 20; d++) {
      const day = ensureDay(s.db, v, `2026-11-${String(d).padStart(2, "0")}`);
      happened += day.happenings.length;
    }
    expect(happened).toBeGreaterThan(0);
    expect(happened).toBeLessThan(20);
  });
});
