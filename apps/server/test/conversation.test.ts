import { calendar } from "@elmsford/content";
import { computeGameTime, PLAYER_ID, zonedToInstant } from "@elmsford/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { ConversationService, type StreamEvent } from "../src/conversation/service";
import { openDb } from "../src/db/client";
import * as t from "../src/db/schema";
import { LlmGateway } from "../src/llm/gateway";
import type { Provider, ProviderCall, ProviderResult } from "../src/llm/types";
import { ensureVillage, getVillage } from "../src/village";
import { heardDays, heardInHeadline } from "../src/world/lore";
import { getInventory, getMemories } from "../src/world/repo";

type Script = (c: ProviderCall) => Partial<ProviderResult>;

function setup(script: Script) {
  const db = openDb(":memory:");
  let now = zonedToInstant(2026, 10, 20, 10, 30, "Asia/Shanghai"); // Hubert sits by the well
  const clock = { now: () => now };
  ensureVillage(db, "local", "Asia/Shanghai", now);
  db.update(t.villages).set({ playerLocationId: "green" }).run();
  const calls: ProviderCall[] = [];
  const provider: Provider = {
    async listModels() {
      return [];
    },
    async call(c) {
      calls.push(c);
      const r = script(c);
      if (r.text) c.onText?.(r.text);
      return { text: "", toolCalls: [], model: c.model, usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", refused: false, ...r };
    },
  };
  const creds = { anthropic: { file: "x", baseURL: null, apiKey: "k", authToken: null, models: {} }, openai: null, notes: [] };
  const gateway = new LlmGateway({ db, clock, config: loadConfig({}), credentials: { get: () => creds }, providerFactory: () => provider });
  const service = new ConversationService(db, clock, gateway);
  const village = () => getVillage(db, "local")!;
  const run = async (f: (emit: (e: StreamEvent) => void) => Promise<void>) => {
    const events: StreamEvent[] = [];
    await f((e) => events.push(e));
    return events;
  };
  return { db, calls, service, village, run, advance: (ms: number) => (now += ms) };
}

const EXTRACTION = JSON.stringify({
  memories: [{ text: "抄写员说他是从南边港口来的", importance: 5, participants: ["hubert", "player"] }],
  factsLearned: [
    { text: "抄写员是从南边港口来的", belief: 0.9 },
    { text: "抄写员会说拉丁语", belief: 0.9 },
  ],
  commitments: [{ by: "player", to: "hubert", text: "替他给北边的弟弟写信", dueInDays: 7 }],
  relationship: { trustDelta: 30, affectionDelta: 2, newSummary: null },
  concerns: { add: ["想托人写信"], remove: [] },
  playerNotes: ["他有个弟弟在北边"],
  keptCommitments: [],
  customsTold: [],
});

describe("conversation", () => {
  it("streams the opening, keeps the transcript, and extracts through the validator", async () => {
    const s = setup((c) => (c.json ? { text: EXTRACTION } : { text: "*抬起下巴* 你就是那个写字的？" }));
    const opened = await s.run((emit) => s.service.start(s.village(), "hubert", emit));
    const start = opened.find((e) => e.type === "start");
    expect(start).toBeDefined();
    expect(opened.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toContain("写字的");

    const id = (start as { conversationId: string }).conversationId;
    await s.run((emit) => s.service.say(s.village(), id, "我是从南边的港口来的。", emit));

    // Player input reaches the model wrapped as the outsider's words, never as instructions.
    const lastDialogue = s.calls.filter((c) => !c.json).at(-1)!;
    expect(lastDialogue.messages.at(-1)!.content).toBe("抄写员：我是从南边的港口来的。");
    expect(lastDialogue.messages[0]!.role).toBe("user");
    expect(lastDialogue.tools?.map((x) => x.name)).toEqual(["give", "ask_to_write", "leave"]);

    await s.service.end(s.village(), id, "player");
    await new Promise((r) => setTimeout(r, 20));

    expect(getMemories(s.db, "local", "hubert").map((m) => m.text)).toEqual(["抄写员说他是从南边港口来的"]);
    const facts = s.db.select().from(t.facts).all().map((f) => f.text);
    expect(facts).toEqual(["抄写员是从南边港口来的"]); // the Latin one was never said
    const rel = s.db.select().from(t.relationships).where(eq(t.relationships.fromId, "hubert")).all().find((r) => r.toId === PLAYER_ID)!;
    expect(rel.trust).toBe(5); // ±30 is over the limit: dropped, not clamped
    expect(s.db.select().from(t.commitments).all()).toHaveLength(1);
    expect(s.db.select().from(t.rejections).all().map((r) => r.field).sort()).toEqual(["facts", "relationships"]);
  });

  it("carries out validated actions and refuses impossible ones", async () => {
    let turn = 0;
    const s = setup((c) => {
      if (c.json) return { text: EXTRACTION };
      turn++;
      if (turn === 1) return { text: "拿着。", toolCalls: [{ name: "give", input: { item: "苹果", quantity: 2, pence: null } }] };
      if (turn === 2) return { text: "还有。", toolCalls: [{ name: "give", input: { item: "金子", quantity: 1, pence: null } }] };
      return { text: "我得走了。", toolCalls: [{ name: "ask_to_write", input: { kind: "letter", recipient: "北边的弟弟", gist: "问他还活着没有" } }, { name: "leave", input: { reason: "回家吃饭" } }] };
    });
    const opened = await s.run((emit) => s.service.start(s.village(), "hubert", emit));
    const id = (opened.find((e) => e.type === "start") as { conversationId: string }).conversationId;
    expect(opened.some((e) => e.type === "action" && e.text.includes("苹果×2"))).toBe(true);
    expect(getInventory(s.db, "local", PLAYER_ID).get("苹果")).toBe(2);
    expect(getInventory(s.db, "local", "hubert").get("苹果")).toBe(1);

    const second = await s.run((emit) => s.service.say(s.village(), id, "谢谢。", emit));
    expect(second.some((e) => e.type === "action")).toBe(false); // he has no gold

    const third = await s.run((emit) => s.service.say(s.village(), id, "您慢走。", emit));
    expect(third.some((e) => e.type === "action" && e.text.includes("托你写一封信"))).toBe(true);
    expect(third.some((e) => e.type === "end" && e.by === "character")).toBe(true);
    expect(s.db.select().from(t.documents).all()[0]).toMatchObject({ commissionedBy: "hubert", recipient: "北边的弟弟", status: "draft" });

    // Walked off: can't be talked to again right away.
    const again = await s.run((emit) => s.service.start(s.village(), "hubert", emit));
    expect(again[0]).toMatchObject({ type: "error" });
  });

  it("rolls back the player's line when the model fails, so it can be retried", async () => {
    let fail = false;
    const s = setup(() => {
      if (fail) throw Object.assign(new Error("boom"), { status: 500 });
      return { text: "嗯。" };
    });
    const opened = await s.run((emit) => s.service.start(s.village(), "hubert", emit));
    const id = (opened.find((e) => e.type === "start") as { conversationId: string }).conversationId;
    fail = true;
    const r = await s.run((emit) => s.service.say(s.village(), id, "你好", emit));
    expect(r.some((e) => e.type === "error")).toBe(true);
    expect(s.service.get(id)!.transcript.map((l) => l.speaker)).toEqual(["scene", "hubert"]);
  });

  it("notes a custom the resident explained, in their words, and nothing they didn't say", async () => {
    const told = JSON.stringify({
      ...JSON.parse(EXTRACTION),
      customsTold: [
        { key: "martinmas", text: "休伯特说，圣马丁节那天杀猪，佃户都来交租", },
        { key: "martinmas", text: "休伯特说，圣马丁是个骑白马的兵" },
      ],
    });
    const s = setup((c) => (c.json ? { text: told } : { text: "圣马丁节那天杀猪，佃户都得来交租。我年轻那会儿管收租。" }));
    const opened = await s.run((emit) => s.service.start(s.village(), "hubert", emit));
    const id = (opened.find((e) => e.type === "start") as { conversationId: string }).conversationId;
    await s.run((emit) => s.service.say(s.village(), id, "圣马丁节是做什么的？", emit));
    await s.service.end(s.village(), id, "player");
    await new Promise((r) => setTimeout(r, 20));

    const days = heardDays(s.db, "local");
    expect(days).toEqual([{ key: "martinmas", name: "圣马丁节", lines: [expect.objectContaining({ text: "休伯特说，圣马丁节那天杀猪，佃户都来交租", from: "休伯特" })] }]);

    // On the day, the headline offers what was heard.
    const gt = computeGameTime(zonedToInstant(2026, 11, 11, 10, 0, "Asia/Shanghai"), "Asia/Shanghai", calendar);
    expect(heardInHeadline(s.db, "local", gt)[0]).toMatchObject({ match: "圣马丁节" });
  });

  it("won't let you talk to someone who isn't here", async () => {
    const s = setup(() => ({ text: "嗯。" }));
    const r = await s.run((emit) => s.service.start(s.village(), "thomas", emit));
    expect(r[0]).toMatchObject({ type: "error", message: "托马斯不在这儿。" });
  });
});

describe("restarting", () => {
  it("picks up an extraction the last shutdown cut off", async () => {
    const s = setup((c) => (c.json ? { text: EXTRACTION } : { text: "嗯。" }));
    const events = await s.run((emit) => s.service.start(s.village(), "hubert", emit));
    const id = (events.find((e) => e.type === "start") as { conversationId: string }).conversationId;
    await s.run((emit) => s.service.say(s.village(), id, "我是从南边港口来的。", emit));
    // Ended, with the extraction still under way when the process stopped.
    s.db.update(t.conversations).set({ endedAt: Date.now(), endedBy: "player", extraction: "pending" }).run();

    const again = new ConversationService(s.db, { now: () => Date.now() + 5 * 60_000 }, (s.service as unknown as { gateway: LlmGateway }).gateway);
    again.resume();
    await again.sweep("local");
    expect(s.db.select().from(t.conversations).where(eq(t.conversations.id, id)).get()?.extraction).toBe("done");
  });
});
