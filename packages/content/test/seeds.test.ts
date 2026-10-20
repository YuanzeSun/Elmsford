import { checkMap, computeGameTime, PLAYER_ID, routineForDay, zonedToInstant } from "@elmsford/core";
import { describe, expect, it } from "vitest";
import { calendar, characters, folk, inSeason, MAX_RESIDENTS, openings, villageMap, loadPrompt, locations, mapRules, relationships, renderPrompt, routines, startingInventory } from "../src";

const locationIds = new Set(locations.map((l) => l.id));
const characterIds = new Set(characters.map((c) => c.id));

describe("seeds", () => {
  it("places everyone somewhere that exists", () => {
    for (const c of characters) {
      expect(locationIds, c.id).toContain(c.seed.homeId);
      expect(locationIds, c.id).toContain(c.initialState.locationId);
    }
  });

  it("has a symmetric, closed location graph", () => {
    for (const l of locations.filter((x) => !x.offstage)) {
      for (const n of l.neighbors) {
        expect(locationIds, `${l.id} → ${n}`).toContain(n);
        expect(locations.find((x) => x.id === n)!.neighbors, `${n} ↛ ${l.id}`).toContain(l.id);
      }
    }
  });

  it("only relates people who exist, once per direction", () => {
    const seen = new Set<string>();
    for (const r of relationships) {
      expect(characterIds).toContain(r.from);
      expect(r.to === PLAYER_ID || characterIds.has(r.to)).toBe(true);
      const key = `${r.from}→${r.to}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    // Everyone has an opinion of the newcomer.
    for (const id of characterIds) expect(seen).toContain(`${id}→${PLAYER_ID}`);
  });
});

describe("prompts", () => {
  it("loads and renders", () => {
    expect(loadPrompt("world")).toContain("写作风格");
    expect(renderPrompt("style-judge", { text: "你好" })).toContain("你好");
    expect(() => renderPrompt("style-judge", {})).toThrow(/text/);
  });
});


describe("routines", () => {
  const day = (y: number, m: number, d: number) => computeGameTime(zonedToInstant(y, m, d, 12, 0, "Asia/Shanghai"), "Asia/Shanghai", calendar);

  it("cover every resident and every hour, in real places", () => {
    for (const c of characters) {
      const r = routines[c.id];
      expect(r, c.id).toBeDefined();
      for (const gt of [day(2026, 10, 20), day(2026, 10, 25), day(2026, 6, 21), day(2026, 12, 21)]) {
        const blocks = routineForDay(r!, gt, { locationId: c.seed.homeId, activity: "在家" });
        expect(blocks[0]!.from, c.id).toBe("00:00");
        expect(blocks.at(-1)!.to, c.id).toBe("24:00");
        for (let i = 1; i < blocks.length; i++) expect(blocks[i]!.from, `${c.id} gap`).toBe(blocks[i - 1]!.to);
        for (const b of blocks) expect(locationIds, `${c.id} ${b.locationId}`).toContain(b.locationId);
      }
    }
  });

  it("sends people to mass on Sundays", () => {
    const sunday = routineForDay(routines.thomas!, day(2026, 10, 25), { locationId: "mill", activity: "在家" });
    expect(sunday.some((b) => b.locationId === "church")).toBe(true);
  });

  it("gives everyone something to start with", () => {
    for (const c of characters) expect(startingInventory[c.id], c.id).toBeDefined();
  });
});

describe("map", () => {
  it("has a fallback that passes its own rules", () => {
    const r = checkMap(villageMap, mapRules);
    expect(r.ok ? [] : r.errors).toEqual([]);
    if (r.ok) expect(r.map.labels.map((l) => l.id).sort()).toEqual(mapRules.required.map((p) => p.id).sort());
  });

  it("rejects maps that get the geography wrong", () => {
    // The fallback upside down: the river in the north, the manor by the water.
    const r = checkMap([...villageMap].reverse(), mapRules);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.errors.join("\n")).toMatch(/“庄园”应该在/);
  });

  it("keeps places out of the river, except the ford", () => {
    const rows = [...villageMap];
    const mill = rows.findIndex((r) => r.includes("磨坊"));
    // Move the mill down into the water.
    rows[mill] = rows[mill]!.replace("磨坊", "  ");
    rows[mill + 1] = rows[mill + 1]!.slice(0, 30) + "磨坊" + rows[mill + 1]!.slice(32);
    const r = checkMap(rows, mapRules);
    expect(r.ok ? "" : r.errors.join("\n")).toMatch(/“磨坊”画进河里了/);
  });

  it("catches the mill drawn in the river (a real drawing, with the lane added since)", () => {
    const drawn = [
      "    ^      ^   ^          #     #       ",
      "       林子                庄园             ",
      "  ^         ^    ^        #   #         ",
      "       ^                                ",
      "   西田       ,              ,      ,     ",
      "       ,         南田               东田    ",
      "   公地       ,           ,               ",
      " ,     ,                 神父家            ",
      "                                        ",
      "         茅舍              教堂   墓园        ",
      "   ,       ,     格林家      #    +  +     ",
      "                   井边      你家           ",
      "             , 巷子      ,          ,     ",
      "                                草场   ,  ",
      "                    酒馆      ,           ",
      "                   #             ,      ",
      "~~~   ~~~~~~    ~~~~渡口~~~~    ~~~   ~~~~",
      "   ~~~      ~~~~    ==    ~~~~ 磨坊~~~    ",
      "        埃尔河        ~  ~        #        ",
      "  ~          ~~~          ~~~      ~~   ",
    ];
    const r = checkMap(drawn, mapRules);
    expect(r.ok ? "" : r.errors.join("\n")).toMatch(/“磨坊”画进河里了/);
  });

  it("rejects maps with missing, repeated or invented places", () => {
    const bad = checkMap(["  井边 井边 ", "你家 酒馆 磁铁", "~~~~~~~~", "........", "........", "........", "........", "........"], mapRules);
    expect(bad.ok).toBe(false);
    const errors = bad.ok ? [] : bad.errors.join("\n");
    expect(errors).toMatch(/“井边”写了 2 次/);
    expect(errors).toMatch(/缺了“磨坊”/);
    expect(errors).toMatch(/多了地名以外的字：磁铁/);
  });
});

describe("newcomers", () => {
  const day = (y: number, m: number, d: number) => computeGameTime(zonedToInstant(y, m, d, 12, 0, "Asia/Shanghai"), "Asia/Shanghai", calendar);
  const names = new Set(characters.flatMap((c) => [c.name, c.shortName]));

  it("are few, and don't clash with the residents", () => {
    expect(folk.length + openings.length).toBeLessThanOrEqual(10);
    expect(MAX_RESIDENTS).toBeLessThanOrEqual(8);
    for (const f of folk) {
      expect(characterIds.has(f.id), f.id).toBe(false);
      expect(names.has(f.name) || names.has(f.shortName), f.name).toBe(false);
      expect(f.name).toContain(f.shortName);
      expect(f.aliases).toContain(f.shortName);
    }
    expect(new Set([...folk, ...openings].map((x) => x.id)).size).toBe(folk.length + openings.length);
  });

  it("live, work and are seen in real places, every hour of the day", () => {
    for (const x of [...folk, ...openings]) {
      expect(locationIds, x.id).toContain(x.homeId);
      for (const gt of [day(2026, 10, 20), day(2026, 10, 25), day(2026, 6, 21), day(2026, 12, 21)]) {
        const blocks = routineForDay(x.routine, gt, { locationId: x.homeId, activity: "在家" });
        expect(blocks[0]!.from, x.id).toBe("00:00");
        expect(blocks.at(-1)!.to, x.id).toBe("24:00");
        expect(blocks.some((b) => b.asleep), `${x.id} sleeps`).toBe(true);
        for (const b of blocks) expect(locationIds, `${x.id} ${b.locationId}`).toContain(b.locationId);
      }
    }
    for (const f of folk) for (const s of f.seen) expect(locationIds, `${f.id} seen`).toContain(s.locationId);
  });

  it("come from outside only in season", () => {
    const hand = openings.find((o) => o.id === "hired_hand")!;
    expect(inSeason(hand, "2026-11-11")).toBe(true);
    expect(inSeason(hand, "2026-10-20")).toBe(false);
    const tinker = openings.find((o) => o.id === "tinker")!;
    expect(inSeason(tinker, "2026-01-15")).toBe(false);
    expect(tinker.stay).toBeDefined();
    expect(tinker.farewell).toContain("{name}");
    for (const o of openings) {
      expect(o.announce, o.id).toContain("{name}");
      if (o.hostId) expect(characterIds).toContain(o.hostId);
    }
  });
});
