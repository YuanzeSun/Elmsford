import { describe, expect, it } from "vitest";
import {
  CONVERSATION_LIMITS,
  emptyDelta,
  PLAYER_ID,
  recallMemories,
  relKey,
  validateDelta,
  type ValidationContext,
  type WorldDelta,
} from "../src";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 9, 20, 8);

describe("memory recall", () => {
  const mems = [
    { id: "old-brother", at: now - 30 * 24 * HOUR, text: "抄写员答应以后替他给北边的弟弟写信", importance: 8, participants: [PLAYER_ID] },
    { id: "yesterday", at: now - 20 * HOUR, text: "抄写员说他是从南边的港口来的", importance: 5, participants: [PLAYER_ID] },
    { id: "trivia", at: now - 40 * 24 * HOUR, text: "井边的石凳又松了", importance: 2, participants: [] },
    { id: "joan", at: now - 2 * HOUR, text: "琼学他说话，惹得一群孩子笑", importance: 4, participants: ["joan"] },
  ];

  it("ranks recent, important, relevant memories first", () => {
    const r = recallMemories(mems, { now, query: "你昨天说的港口", focusIds: [PLAYER_ID], limit: 2, echoChance: 0 });
    expect(r.items.map((m) => m.id)).toEqual(["yesterday", "joan"]);
  });

  it("lets an old important memory echo back", () => {
    const r = recallMemories(mems, { now, query: "天气", focusIds: [], limit: 2, echoChance: 1, rng: () => 0 });
    expect(r.echo?.id).toBe("old-brother");
  });

  it("never echoes trivia or something already in context", () => {
    const r = recallMemories(mems, { now, query: "", focusIds: [], limit: 1, echoChance: 1, rng: () => 0.99, exclude: new Set(["old-brother"]) });
    expect(r.echo).toBeUndefined();
  });
});

describe("validator", () => {
  const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
    now,
    participants: ["hubert", PLAYER_ID],
    characters: new Map([
      ["hubert", { here: true, concerns: ["眼睛越来越花"], money: 25 }],
      ["joan", { here: true, concerns: [], money: 9 }],
    ]),
    playerMoney: 30,
    relationships: new Map([[relKey("hubert", PLAYER_ID), { trust: 5, affection: 0 }]]),
    knownFacts: new Map(),
    utterances: { [PLAYER_ID]: "我是从南边的港口来的，以前在修道院里抄书。" },
    inventory: new Map([["hubert", new Map([["苹果", 2]])]]),
    locationIds: new Set(["green", "player_house"]),
    limits: CONVERSATION_LIMITS,
    ...over,
  });
  const delta = (over: Partial<WorldDelta>): WorldDelta => ({ ...emptyDelta(), ...over });

  it("keeps grounded facts and drops invented ones", () => {
    const { delta: d, rejected } = validateDelta(
      delta({
        facts: [
          { characterId: "hubert", text: "抄写员是从南边港口来的", belief: 0.9, source: PLAYER_ID },
          { characterId: "hubert", text: "抄写员杀过人", belief: 0.5, source: PLAYER_ID },
        ],
      }),
      ctx(),
    );
    expect(d.facts.map((f) => f.text)).toEqual(["抄写员是从南边港口来的"]);
    expect(rejected[0]?.reason).toMatch(/grounded/);
  });

  it("caps how far a view can move in one conversation", () => {
    const { delta: d, rejected } = validateDelta(
      delta({ relationships: [{ from: "hubert", to: PLAYER_ID, trustDelta: 25, affectionDelta: 3 }] }),
      ctx(),
    );
    expect(d.relationships).toEqual([]);
    expect(rejected[0]?.reason).toMatch(/±10/);
  });

  it("only lets participants remember, promise and change", () => {
    const { delta: d, rejected } = validateDelta(
      delta({
        memories: [
          { characterId: "joan", text: "她听说了这件事", importance: 3, participants: [] },
          { characterId: "hubert", text: "抄写员问起他年轻时候的村子", importance: 6, participants: [PLAYER_ID] },
        ],
        commitments: [{ by: PLAYER_ID, to: "hubert", text: "替他给弟弟写信", due: now + 3 * 86_400_000 }],
        relationships: [{ from: PLAYER_ID, to: "hubert", trustDelta: 1, affectionDelta: 1 }],
      }),
      ctx(),
    );
    expect(d.memories.map((m) => m.characterId)).toEqual(["hubert"]);
    expect(d.commitments).toHaveLength(1);
    expect(d.relationships).toEqual([]);
    expect(rejected).toHaveLength(2);
  });

  it("refuses to give what isn't there", () => {
    const { delta: d, rejected } = validateDelta(
      delta({
        transfers: [
          { from: "hubert", to: PLAYER_ID, item: "苹果", quantity: 2 },
          { from: "hubert", to: PLAYER_ID, item: "苹果", quantity: 1 },
          { from: "hubert", to: PLAYER_ID, pence: 40 },
          { from: PLAYER_ID, to: "hubert", pence: 2 },
        ],
      }),
      ctx(),
    );
    expect(d.transfers).toEqual([
      { from: "hubert", to: PLAYER_ID, item: "苹果", quantity: 2 },
      { from: PLAYER_ID, to: "hubert", pence: 2 },
    ]);
    expect(rejected.map((r) => r.reason)).toEqual(["doesn't have it", "not enough money"]);
  });

  it("removes only concerns that exist", () => {
    const { delta: d } = validateDelta(
      delta({ concerns: [{ characterId: "hubert", add: ["想托人写信"], remove: ["眼睛越来越花", "没有的事"] }] }),
      ctx(),
    );
    expect(d.concerns).toEqual([{ characterId: "hubert", add: ["想托人写信"], remove: ["眼睛越来越花"] }]);
  });

  it("notes a custom only if the resident really talked about it", () => {
    const c = ctx({
      lore: new Map([["martinmas", "圣马丁节"]]),
      utterances: { hubert: "圣马丁节那天杀猪，佃户都得来交租，我年轻那会儿就管收租。" },
    });
    const { delta: d, rejected } = validateDelta(
      delta({
        lore: [
          { key: "martinmas", text: "休伯特说圣马丁节杀猪、佃户交租", source: "hubert" },
          { key: "martinmas", text: "圣马丁是骑白马的士兵", source: "hubert" },
          { key: "christmas", text: "圣诞节要杀猪", source: "hubert" },
          { key: "martinmas", text: "杀猪、交租", source: PLAYER_ID },
        ],
      }),
      c,
    );
    expect(d.lore.map((l) => l.text)).toEqual(["休伯特说圣马丁节杀猪、佃户交租"]);
    expect(rejected.map((r) => r.reason)).toEqual(["not grounded in what they said", "unknown custom", "only a resident who was there can have said it"]);
  });

  it("passes on a fact only if the teller knows it", () => {
    const c = ctx({ participants: ["hubert", "joan"], knownFacts: new Map([["hubert", new Set(["f1"])]]) });
    const { delta: d, rejected } = validateDelta(
      delta({
        facts: [
          { characterId: "joan", text: "磨坊的水轮轴裂了", belief: 0.8, source: "hubert", factId: "f1" },
          { characterId: "hubert", text: "琼要嫁人了", belief: 0.8, source: "joan", factId: "f2" },
        ],
      }),
      c,
    );
    expect(d.facts).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/teller/);
  });
});
