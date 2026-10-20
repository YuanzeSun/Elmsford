// People joining and leaving: a villager stepping forward, a stranger passing through.

import { randomUUID } from "node:crypto";
import { calendar } from "@elmsford/content";
import { computeGameTime, PLAYER_ID, zonedToInstant } from "@elmsford/core";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db/client";
import * as t from "../src/db/schema";
import { LlmGateway } from "../src/llm/gateway";
import type { Provider, ProviderCall, ProviderResult } from "../src/llm/types";
import { buildDossier } from "../src/conversation/context";
import { settleDay } from "../src/sim/days";
import { considerArrival, considerSteppingForward, mentionCounts, queueNewcomer, welcome } from "../src/sim/newcomers";
import { ensureVillage, getVillage } from "../src/village";
import { placeView } from "../src/world/place";
import { presenceOf } from "../src/world/presence";
import { getCharacter, getKnownFacts, getRelationship, getResidents } from "../src/world/repo";

const TZ = "Asia/Shanghai";
const DAY = 86_400_000;

const person = (over: Record<string, unknown> = {}) => ({
  name: "罗伯特·泰勒",
  shortName: "罗伯特",
  age: 44,
  occupation: "补锅匠",
  personality: "嘴碎，见多识广，看人很准。",
  cares: "路上平安，冬天之前攒够钱。",
  flaws: "爱夸大其词。",
  wants: "找个地方落脚，嘴上不认。",
  situation: "刚从金斯伯里过来，担子上的锡快用完了。",
  speech: "说话拖着长音，爱讲别处的事。",
  household: "一个人。",
  mood: "乏了",
  concerns: ["锡快用完了"],
  memories: [{ text: "在金斯伯里的集上替人补了三口锅", importance: 3 }],
  views: [{ personId: "thomas", trust: 30, affection: 20, summary: "爹，心思全在磨坊上" }],
  seenBy: [{ personId: "thomas", trust: 10, affection: 40, summary: "大儿子，心不在磨坊上" }],
  ...over,
});

function setup(drafts: Record<string, unknown>[] = [person()]) {
  const db = openDb(":memory:");
  let now = zonedToInstant(2026, 10, 25, 20, 0, TZ); // a Sunday evening
  const clock = { now: () => now };
  ensureVillage(db, "local", TZ, now - 30 * DAY);
  const calls: ProviderCall[] = [];
  let next = 0;
  const provider: Provider = {
    async listModels() {
      return [];
    },
    async call(c) {
      calls.push(c);
      const text = c.json?.name === "newcomer" ? JSON.stringify(drafts[Math.min(next++, drafts.length - 1)]) : "{}";
      return { text, toolCalls: [], model: c.model, usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", refused: false } satisfies ProviderResult;
    },
  };
  const creds = { anthropic: { file: "x", baseURL: null, apiKey: "k", authToken: null, models: {} }, openai: null, notes: [] };
  const config = { ...loadConfig({}), villageDailyBudgetUsd: 100, globalDailyCapUsd: 100 };
  const gateway = new LlmGateway({ db, clock, config, credentials: { get: () => creds }, providerFactory: () => provider });
  const remember = (characterId: string, text: string, at: number) =>
    db.insert(t.memories).values({ id: randomUUID(), villageId: "local", characterId, at, text, importance: 3, participants: [], factIds: [] }).run();
  return { db, gateway, calls, village: () => getVillage(db, "local")!, now: () => now, setNow: (x: number) => (now = x), remember };
}

describe("a villager stepping forward", () => {
  it("happens once they keep coming up, and they join knowing and known", async () => {
    const s = setup([person({ name: "x", shortName: "x", age: 1, occupation: "x" })]);
    for (let i = 0; i < 5; i++) s.remember("thomas", `瓦特又说要去城里当学徒（${i}）`, s.now() - (i + 1) * DAY);
    s.remember("joan", "瓦特在磨坊门口冲她笑了一下", s.now() - 20 * DAY); // too long ago to count
    expect(mentionCounts(s.db, "local", s.now() - 14 * DAY, s.now()).get("wat")).toBe(5);

    const row = considerSteppingForward(s.db, s.village(), "2026-10-25", s.now());
    expect(row).toMatchObject({ kind: "folk", sourceId: "wat", characterId: "wat" });
    await welcome(s.db, s.gateway, s.village(), row!.at);

    // Content fixes who he is; the model's name and age don't count.
    const wat = getCharacter(s.db, "local", "wat")!;
    expect(wat).toMatchObject({ name: "瓦特·韦尔", shortName: "瓦特", age: 17, status: "here", origin: "folk" });
    expect(wat.seed.homeId).toBe("mill");
    expect(getRelationship(s.db, "local", "thomas", "wat")?.summary).toBe("大儿子，心不在磨坊上");
    expect(getRelationship(s.db, "local", "joan", "wat")?.summary).toBe("同村的人，没什么来往");
    expect(getRelationship(s.db, "local", "wat", PLAYER_ID)).toBeDefined();

    // What residents were told about him reached the model.
    const task = s.calls.find((c) => c.json?.name === "newcomer")!.messages[0]!.content as string;
    expect(task).toContain("瓦特又说要去城里当学徒");
    expect(task).toContain("托马斯家里");

    // Not again so soon, even if he's talked about.
    expect(considerSteppingForward(s.db, s.village(), "2026-11-01", s.now() + 7 * DAY)).toBeNull();
  });

  it("is glimpsed going about their day until then, and is a person you can talk to after", async () => {
    const s = setup();
    s.db.update(t.villages).set({ playerLocationId: "mill" }).run();
    const mornings = Array.from({ length: 12 }, (_, i) => zonedToInstant(2026, 10, 26 + Math.floor(i / 3), 9 + (i % 3), 10, TZ));
    const glimpses = () => mornings.map((at) => placeView(s.db, s.village(), at)).filter((v) => v.scene.includes("瓦特扛着"));
    expect(glimpses().length).toBeGreaterThan(0);
    queueNewcomer(s.db, "local", "folk", "wat", s.now(), s.now());
    await welcome(s.db, s.gateway, s.village(), s.now());
    expect(glimpses()).toHaveLength(0);
    expect(mornings.some((at) => placeView(s.db, s.village(), at).people.some((p) => p.name === "瓦特"))).toBe(true);
  });

  it("leaves a place free for someone from outside", async () => {
    const s = setup();
    for (const id of ["agnes", "roger"]) {
      queueNewcomer(s.db, "local", "folk", id, s.now(), s.now());
      await welcome(s.db, s.gateway, s.village(), s.now());
    }
    expect(getResidents(s.db, "local")).toHaveLength(7);
    for (let i = 0; i < 6; i++) s.remember("joan", `玛格丽又催她应了那门亲事（${i}）`, s.now() - (i + 1) * DAY);
    expect(considerSteppingForward(s.db, s.village(), "2026-11-15", s.now() + 21 * DAY)).toBeNull();
  });

  it("is told to the residents, who can talk about the rest of the village", async () => {
    const s = setup();
    queueNewcomer(s.db, "local", "folk", "wat", s.now(), s.now());
    await welcome(s.db, s.gateway, s.village(), s.now());
    const joan = getCharacter(s.db, "local", "joan")!;
    const dossier = buildDossier(s.db, s.village(), joan, s.now(), [], "抄写员走过来。");
    expect(dossier.situation).toContain("瓦特（在磨坊给他爹帮工）");
    expect(dossier.situation).toMatch(/村里还有：.*艾格尼丝/);
  });
});

describe("a stranger passing through", () => {
  it("comes, is heard of, lodges with Matilda, and moves on", async () => {
    // The first draft takes a resident's name; the model is told and writes another.
    const s = setup([person({ name: "玛蒂尔达·克罗夫特", shortName: "玛蒂尔达" }), person()]);
    const row = queueNewcomer(s.db, "local", "arrival", "tinker", s.now(), s.now())!;
    await welcome(s.db, s.gateway, s.village(), s.now());
    const drafts = s.calls.filter((c) => c.json?.name === "newcomer");
    expect(drafts).toHaveLength(2);
    expect(drafts[1]!.messages.at(-1)!.content).toMatch(/已经有人叫/);

    const tinker = getCharacter(s.db, "local", row.characterId)!;
    expect(tinker).toMatchObject({ shortName: "罗伯特", status: "here", origin: "arrival" });
    expect(tinker.leavesOn).toBeTruthy();
    // Strangers know nobody: the model's view of Thomas is kept but mild.
    expect(getRelationship(s.db, "local", tinker.id, "thomas")).toMatchObject({ trust: 20, affection: 20 });
    expect(getRelationship(s.db, "local", "matilda", tinker.id)?.summary).toBe("新来的走村串户的补锅匠，还不知道底细");
    expect(getKnownFacts(s.db, "local", "hubert").some((f) => f.text.includes("补锅匠，叫罗伯特"))).toBe(true);
    const arrival = s.db.select().from(t.worldEvents).where(and(eq(t.worldEvents.villageId, "local"), eq(t.worldEvents.type, "arrival"))).get();
    expect(arrival?.visibleTo).toEqual(["public"]);

    // The evening before he goes, the day settles and he's off in the morning.
    const [y, m, d] = tinker.leavesOn!.split("-").map(Number) as [number, number, number];
    const eve = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    settleDay(s.db, s.village(), eve);
    expect(getCharacter(s.db, "local", tinker.id)!.status).toBe("gone");
    expect(getResidents(s.db, "local").some((c) => c.id === tinker.id)).toBe(false);
    const departure = s.db.select().from(t.worldEvents).where(and(eq(t.worldEvents.villageId, "local"), eq(t.worldEvents.type, "departure"))).get();
    expect((departure?.payload as { text: string }).text).toBe("补锅匠罗伯特挑着担子走了，往下一个村子去了。");
  });

  it("doesn't come in the player's first week, or out of season", () => {
    const s = setup();
    const fresh = { ...s.village(), createdAt: s.now() };
    expect(considerArrival(s.db, fresh, "2026-10-25", s.now())).toBeNull();
    // The hired hand's window is around Martinmas; January is no time for a tinker either.
    expect(considerArrival(s.db, s.village(), "2026-01-10", s.now())).toBeNull();
  });

  it("makes their host's house theirs too: the door is open while either is home", async () => {
    const s = setup();
    queueNewcomer(s.db, "local", "arrival", "tinker", s.now(), s.now());
    await welcome(s.db, s.gateway, s.village(), s.now());
    s.db.update(t.villages).set({ playerLocationId: "green" }).run();
    // A moment when Matilda is out at the well and he's in, eating.
    const where = (id: string, at: number) => presenceOf(s.db, "local", getCharacter(s.db, "local", id)!, computeGameTime(at, TZ, calendar)).block.locationId;
    const day = zonedToInstant(2026, 10, 26, 10, 0, TZ);
    const at = Array.from({ length: 240 }, (_, i) => day + i * 60_000).find((x) => where("matilda", x) !== "alehouse" && where("tinker-1", x) === "alehouse");
    expect(at).toBeDefined();
    const exit = placeView(s.db, s.village(), at!).exits.find((e) => e.id === "alehouse");
    expect(exit?.note).toBeUndefined();
  });
});
