import { computeGameTime, customsAround, signsHere, zonedToInstant } from "@elmsford/core";
import { describe, expect, it } from "vitest";
import { calendar, characters, customs, locations } from "../src";

const TZ = "Asia/Shanghai";
const at = (m: number, d: number, h: number, y = 2026) => computeGameTime(zonedToInstant(y, m, d, h, 0, TZ), TZ, calendar);
const feastIds = new Set(calendar.feasts.map((f) => f.id));
const placeIds = new Set(locations.map((l) => l.id));
const people = new Set(characters.map((c) => c.id));

describe("customs", () => {
  it("only refer to real feasts, places and people", () => {
    const keys = new Set<string>();
    for (const c of customs) {
      expect(keys.has(c.key), c.key).toBe(false);
      keys.add(c.key);
      if ("feast" in c.when) expect(feastIds, c.key).toContain(c.when.feast);
      for (const id of Object.keys(c.personal ?? {})) expect(people, `${c.key} ${id}`).toContain(id);
      for (const s of c.signs ?? []) for (const l of s.at ?? []) expect(placeIds, `${c.key} ${l}`).toContain(l);
    }
  });

  it("show candles in the churchyard on All Souls evening, not at noon", () => {
    const evening = at(11, 2, 18);
    const noon = at(11, 2, 12);
    expect(signsHere(customsAround(evening, calendar, customs), "churchyard", evening.period).join()).toMatch(/蜡烛/);
    expect(signsHere(customsAround(noon, calendar, customs), "churchyard", noon.period).join()).not.toMatch(/蜡烛/);
  });

  it("let Martinmas be felt coming before it arrives", () => {
    const before = at(11, 9, 10);
    const ahead = customsAround(before, calendar, customs).find((x) => x.custom.key === "martinmas");
    expect(ahead?.offset).toBe(-2);
    expect(signsHere(customsAround(before, calendar, customs), "atwood_cottage", before.period).join()).toMatch(/猪/);
    expect(signsHere(customsAround(at(11, 1, 10), calendar, customs), "green", "morning").join()).not.toMatch(/磨刀/);
  });

  it("know the season and the fasts", () => {
    expect(customsAround(at(12, 5, 10), calendar, customs).map((x) => x.custom.key)).toContain("advent");
    expect(customsAround(at(10, 23, 10), calendar, customs).map((x) => x.custom.key)).toContain("fast:friday");
  });
});
