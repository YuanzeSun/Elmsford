import { describe, expect, it } from "vitest";
import { validateNewcomer, type NewcomerDraft, type NewcomerRules } from "../src";

const draft = (over: Partial<NewcomerDraft> = {}): NewcomerDraft => ({
  name: "罗伯特·泰勒",
  shortName: "罗伯特",
  age: 40,
  occupation: "走村串户的补锅匠",
  personality: "嘴碎，见多识广，看人很准。",
  cares: "路上平安，冬天之前攒够钱。",
  flaws: "爱夸大其词，话传到他嘴里就变了样。",
  wants: "找个地方落脚，他自己不肯承认。",
  situation: "刚从金斯伯里过来，担子上的锡快用完了。",
  speech: "说话拖着长音，爱讲别处的事。",
  household: "一个人，走到哪儿住到哪儿。",
  mood: "乏了",
  concerns: ["锡快用完了", "天要冷了", "鞋底磨穿了", "第四件"],
  memories: [{ text: "在金斯伯里的集上替人补了三口锅", importance: 3 }],
  views: [{ personId: "matilda", trust: 50, affection: 40, summary: "肯让他借住的酿酒寡妇" }],
  seenBy: [
    { personId: "matilda", trust: 5, affection: 0, summary: "借住的补锅匠，看着嘴碎" },
    { personId: "nobody", trust: 0, affection: 0, summary: "不存在的人" },
  ],
  ...over,
});

const rules: NewcomerRules = { ages: [30, 60], taken: new Set(["玛蒂尔达·克罗夫特", "玛蒂尔达"]), residents: new Set(["matilda", "joan"]), maxFeeling: 20 };

describe("validateNewcomer", () => {
  it("keeps a stranger who holds together, trimming what doesn't", () => {
    const r = validateNewcomer(draft(), rules);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newcomer.concerns).toHaveLength(3);
    // Strangers start with mild feelings, and only about people who live here.
    expect(r.newcomer.views[0]).toMatchObject({ personId: "matilda", trust: 20, affection: 20 });
    expect(r.newcomer.seenBy.map((v) => v.personId)).toEqual(["matilda"]);
  });

  it("asks again for a taken or malformed name, a wrong age, an empty personality", () => {
    const taken = validateNewcomer(draft({ name: "玛蒂尔达·克罗夫特", shortName: "玛蒂尔达" }), rules);
    expect(taken.ok ? [] : taken.errors.join()).toMatch(/已经有人叫/);
    const latin = validateNewcomer(draft({ name: "Robert Taylor", shortName: "Rob" }), rules);
    expect(latin.ok).toBe(false);
    const notPart = validateNewcomer(draft({ shortName: "老罗" }), rules);
    expect(notPart.ok ? [] : notPart.errors.join()).toMatch(/shortName/);
    const young = validateNewcomer(draft({ age: 12 }), rules);
    expect(young.ok ? [] : young.errors.join()).toMatch(/age/);
    const empty = validateNewcomer(draft({ personality: " " }), rules);
    expect(empty.ok ? [] : empty.errors.join()).toMatch(/personality/);
  });

  it("takes name, age and trade from content for someone the village already knows", () => {
    const r = validateNewcomer(draft({ name: "随便写的", age: 99 }), {
      ...rules,
      fixed: { name: "瓦特·韦尔", shortName: "瓦特", age: 17 },
      occupation: "在磨坊给他爹帮工",
      ages: [17, 17],
      maxFeeling: 70,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newcomer).toMatchObject({ name: "瓦特·韦尔", shortName: "瓦特", age: 17, occupation: "在磨坊给他爹帮工" });
  });
});
