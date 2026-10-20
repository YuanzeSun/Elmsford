// 按自己的步子过: the village's own clock, moved by walking, talking and resting.

import { calendar } from "@elmsford/content";
import { computeGameTime, zonedToInstant, type PlanBlock } from "@elmsford/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ClockService } from "../src/clock";
import { loadConfig } from "../src/config";
import type { StreamEvent } from "../src/conversation/service";
import { openDb } from "../src/db/client";
import * as t from "../src/db/schema";
import { LlmGateway } from "../src/llm/gateway";
import type { Provider, ProviderCall, ProviderResult } from "../src/llm/types";
import { latestUnseenRecap } from "../src/sim/recap";
import { getVillage } from "../src/village";
import { testAccounts, testServices } from "./helpers";

const TZ = "Asia/Shanghai";
const MINUTE = 60_000;

type Dialogue = (c: ProviderCall) => Partial<ProviderResult>;

async function setup(mode: "story" | "real", dialogue: Dialogue = () => ({ text: "嗯。" })) {
  const db = openDb(":memory:");
  const config = { ...loadConfig({}), devMode: true, villageDailyBudgetUsd: 100, globalDailyCapUsd: 100 };
  const clock = new ClockService(db, true);
  // Outside the village it's mid-afternoon, and stays there.
  clock.adjust({ speed: 0, jumpTo: zonedToInstant(2026, 10, 20, 15, 0, TZ) });
  const calls: ProviderCall[] = [];
  const provider: Provider = {
    async listModels() {
      return [];
    },
    async call(c) {
      calls.push(c);
      const base = { text: "", toolCalls: [], model: c.model, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", refused: false } satisfies ProviderResult;
      if (c.json?.name === "day_plans" || c.json?.name === "reflection") return { ...base, text: JSON.stringify({ residents: [] }) };
      if (c.json?.name === "encounters") return { ...base, text: JSON.stringify({ encounters: [] }) };
      if (c.json) return { ...base, text: "{}" };
      if (c.tools?.length) {
        const r = dialogue(c);
        if (r.text) c.onText?.(r.text);
        return { ...base, ...r };
      }
      return { ...base, text: "你歇了一天。" };
    },
  };
  const creds = { anthropic: { file: "x", baseURL: null, apiKey: "k", authToken: null, models: {} }, openai: null, notes: [] };
  const gateway = new LlmGateway({ db, clock, config, credentials: { get: () => creds }, providerFactory: () => provider });
  const services = testServices(db, clock, gateway);
  const app = createApp({ db, clock, gateway, config, ...services, ...testAccounts() });

  const post = (path: string, body: unknown = {}) =>
    app.request(new Request(`http://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
  await post("/api/session", { timeZone: TZ });
  await post("/api/start", { mode });
  const settle = () => services.sim.settle("local");
  await settle();

  const now = () => computeGameTime(clock.now(), TZ, calendar);
  const village = () => getVillage(db, "local")!;
  return { db, clock, calls, services, post, json, settle, now, village, app };
}

const clockText = (gt: { hour: number; minute: number }) => `${String(gt.hour).padStart(2, "0")}:${String(gt.minute).padStart(2, "0")}`;

interface Place {
  location: { id: string };
  people: { id: string; lookingForYou: boolean }[];
  note: string | null;
}

describe("story mode", () => {
  it("starts on the morning of the first day, and stands still until you do something", async () => {
    const s = await setup("story");
    expect(clockText(s.now())).toBe("07:00");
    expect(s.now().date).toBe("2026-10-20");
    const now = await s.json<{ clock: { mode: string }; story: { segment: string; next: string } }>(s.app.request("/api/now"));
    expect(now).toMatchObject({ clock: { mode: "story" }, story: { segment: "morning", next: "下午" } });
    // The dev clock can't speed it up; it only jumps ahead.
    s.clock.adjust({ speed: 600 });
    expect(clockText(s.now())).toBe("07:00");
  });

  it("takes a while to walk somewhere", async () => {
    const s = await setup("story");
    const r = await s.json<{ ok: boolean; place: Place }>(s.post("/api/move", { to: "green" }));
    expect(r.place.location.id).toBe("green");
    expect(clockText(s.now())).toBe("07:10");
  });

  it("rests until the next part of the day", async () => {
    const s = await setup("story");
    await s.json(s.post("/api/rest", { until: "segment" }));
    expect(clockText(s.now())).toBe("12:00");
    expect((await s.json<{ story: { next: string } }>(s.app.request("/api/now"))).story.next).toBe("晚上");
  });

  it("is cut short by someone coming to find you", async () => {
    const s = await setup("story");
    const blocks: PlanBlock[] = [
      { from: "00:00", to: "09:00", locationId: "atwood_cottage", activity: "在家" },
      { from: "09:00", to: "09:30", locationId: "player_house", activity: "来找抄写员", intent: "托他给邻村那人回个话", withIds: ["player"] },
      { from: "09:30", to: "24:00", locationId: "atwood_cottage", activity: "在家" },
    ];
    s.db.insert(t.dayPlans).values({ villageId: "local", characterId: "joan", date: "2026-10-20", blocks }).onConflictDoUpdate({ target: [t.dayPlans.villageId, t.dayPlans.characterId, t.dayPlans.date], set: { blocks } }).run();
    const r = await s.json<{ place: Place }>(s.post("/api/rest", { until: "segment" }));
    expect(clockText(s.now())).toBe("09:01");
    expect(r.place.note).toBe("琼来找你了。");
    expect(r.place.people.find((p) => p.id === "joan")?.lookingForYou).toBe(true);
  });

  it("ends the evening in bed, waking up the next morning", async () => {
    const s = await setup("story");
    await s.json(s.post("/api/move", { to: "green" }));
    s.clock.setStory(zonedToInstant(2026, 10, 20, 20, 55, TZ));
    const r = await s.json<{ place: Place }>(s.post("/api/move", { to: "church" }));
    expect(r.place.location.id).toBe("player_house");
    expect(r.place.note).toBe("天黑透了，你回家睡下。");
    expect(s.now().date).toBe("2026-10-21");
    expect(clockText(s.now())).toBe("07:00");
  });

  it("lets the rest of a day go, and tells you what you missed", async () => {
    const s = await setup("story");
    await s.json(s.post("/api/move", { to: "green" }));
    await s.json(s.post("/api/rest", { until: "day" }));
    expect(s.now().date).toBe("2026-10-21");
    expect(clockText(s.now())).toBe("07:00");
    expect(s.village().playerLocationId).toBe("player_house");
    await s.settle();
    expect(latestUnseenRecap(s.db, "local")).toMatchObject({ kind: "rested", status: "ready" });
  });

  it("counts talk by how much was said, and what you did together by what the resident says", async () => {
    let tools: string[] = [];
    const s = await setup("story", (c) => {
      tools = (c.tools ?? []).map((x) => x.name);
      return { text: "坐吧。这太阳还行。", toolCalls: [{ name: "time_passes", input: { minutes: 40, doing: "坐在石凳上晒太阳" } }] };
    });
    // Twenty minutes before the noon bell, by the well where Hubert sits.
    const noon = computeGameTime(zonedToInstant(2026, 10, 20, 12, 0, TZ), TZ, calendar).bells.today.find((b) => b.id === "noon")!.minute;
    s.clock.setStory(zonedToInstant(2026, 10, 20, Math.floor((noon - 20) / 60), (noon - 20) % 60, TZ));
    s.db.update(t.villages).set({ playerLocationId: "green" }).run();
    const before = s.clock.now();
    const events: StreamEvent[] = [];
    await s.services.conversations.start(s.village(), "hubert", (e) => events.push(e));

    expect(tools).toContain("time_passes");
    expect(s.clock.now() - before).toBe(41 * MINUTE);
    expect(events.filter((e) => e.type === "scene").map((e) => (e as { text: string }).text)).toEqual(["过了小半个钟头。", "午钟响了。"]);
  });
});

describe("real time", () => {
  it("has no resting, and walking doesn't move the clock", async () => {
    const s = await setup("real");
    const before = s.clock.now();
    expect((await s.post("/api/rest", { until: "segment" })).status).toBe(409);
    await s.json(s.post("/api/move", { to: "green" }));
    expect(s.clock.now()).toBe(before);
    expect((await s.json<{ story: unknown }>(s.app.request("/api/now"))).story).toBeNull();
  });
});
