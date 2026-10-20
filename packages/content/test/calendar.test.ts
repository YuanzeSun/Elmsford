import { computeGameTime, describeDay, describeTime, isWet, rollWeather, zonedToInstant, type GameTime, type Weather } from "@elmsford/core";
import { describe, expect, it } from "vitest";
import { calendar, climate, weatherWords } from "../src";

const TZ = "Asia/Shanghai";
const at = (y: number, mo: number, d: number, h = 12, mi = 0, tz = TZ): GameTime =>
  computeGameTime(zonedToInstant(y, mo, d, h, mi, tz), tz, calendar);

describe("reckoning the day by feasts", () => {
  it("counts days after the last feast", () => {
    expect(describeDay(at(2026, 10, 20))).toBe("今天是圣路加节后第二天");
    expect(describeDay(at(2026, 10, 19))).toBe("今天是圣路加节次日");
  });

  it("names feast days and their eves", () => {
    expect(describeDay(at(2026, 10, 28))).toBe("今天是圣西门与圣犹大节");
    expect(describeDay(at(2026, 10, 31))).toBe("今天是诸圣节前夕");
    expect(describeDay(at(2026, 12, 24))).toBe("今天是圣诞节前夕");
    expect(describeDay(at(2026, 4, 5))).toBe("今天是复活节");
  });

  it("moves St Matthias in leap years", () => {
    expect(describeDay(at(2028, 2, 25))).toBe("今天是圣马提亚节");
    expect(describeDay(at(2027, 2, 24))).toBe("今天是圣马提亚节");
  });

  it("finds Plough Monday and Advent Sunday", () => {
    expect(describeDay(at(2027, 1, 11))).toBe("今天是犁地星期一");
    expect(describeDay(at(2026, 11, 29))).toBe("今天是将临期第一主日");
  });
});

describe("fasting and holy days", () => {
  it("keeps Fridays, Lent, ember days and vigils", () => {
    expect(at(2026, 10, 23).liturgical.fasting).toEqual(["friday"]);
    expect(at(2026, 2, 19).liturgical.fasting).toContain("lent"); // Thursday after Ash Wednesday 2026
    expect(at(2026, 9, 16).liturgical.fasting).toContain("ember"); // Wednesday after Holy Cross
    expect(at(2026, 10, 31).liturgical.fasting).toContain("vigil");
    expect(at(2026, 10, 25).liturgical.fasting).toEqual([]); // Sunday
  });

  it("marks holy days and seasons", () => {
    expect(at(2026, 10, 18).liturgical.holyDay).toBe(true);
    expect(at(2026, 10, 20).liturgical.holyDay).toBe(false);
    expect(at(2026, 10, 20).liturgical.season).toBe("trinity");
    expect(at(2026, 12, 1).liturgical.season).toBe("advent");
    expect(at(2027, 1, 2).liturgical.season).toBe("christmastide");
    expect(at(2026, 3, 1).liturgical.season).toBe("lent");
  });

  it("describes a vigil with its feast", () => {
    expect(describeTime(at(2026, 10, 31), calendar).fasting).toBe("今天守斋：诸圣节前夕。");
  });
});

describe("bells", () => {
  it("rings vespers about an hour before sunset", () => {
    const gt = at(2026, 10, 20);
    const vespers = gt.bells.today.find((b) => b.id === "vespers")!.minute;
    expect(gt.sun.sunset - vespers).toBeGreaterThan(40);
    expect(gt.sun.sunset - vespers).toBeLessThan(60);
  });

  it("says the vespers bell just rang right after it does", () => {
    const vespers = at(2026, 10, 20).bells.today.find((b) => b.id === "vespers")!.minute;
    const gt = at(2026, 10, 20, Math.floor((vespers + 5) / 60), (vespers + 5) % 60);
    expect(describeTime(gt, calendar).headline).toBe("今天是圣路加节后第二天，刚敲过晚祷钟。");
    expect(gt.period).toBe("evening");
  });

  it("rings the mass bell only on holy days", () => {
    expect(at(2026, 10, 18).bells.today.some((b) => b.id === "mass")).toBe(true);
    expect(at(2026, 10, 20).bells.today.some((b) => b.id === "mass")).toBe(false);
  });

  it("wraps to yesterday's curfew before dawn", () => {
    const gt = at(2026, 10, 20, 3, 0);
    expect(gt.bells.last.id).toBe("curfew");
    expect(gt.bells.next.id).toBe("dawn");
    expect(gt.period).toBe("deep_night");
    expect(gt.light).toBe("night");
  });

  it("follows DST on the player's wall clock", () => {
    const summer = at(2026, 7, 1, 12, 0, "Europe/London");
    expect(summer.sun.solarNoon).toBeGreaterThan(12 * 60 + 50); // BST shifts noon to ~13:00
  });
});


describe("weather", () => {
  it("is deterministic and seasonal", () => {
    const a = rollWeather(climate[9]!, null, "v:2026-10-20", weatherWords);
    expect(rollWeather(climate[9]!, null, "v:2026-10-20", weatherWords)).toEqual(a);
    let prev: Weather | null = null;
    let wet = 0;
    let summerTemp = 0;
    let winterTemp = 0;
    for (let d = 0; d < 365; d++) {
      const w: Weather = rollWeather(climate[d % 12]!, prev, `v:${d}`, weatherWords);
      if (isWet(w)) wet++;
      if (d % 12 === 6) summerTemp += w.tempC;
      if (d % 12 === 0) winterTemp += w.tempC;
      expect(w.text).toMatch(/。$/);
      prev = w;
    }
    expect(wet / 365).toBeGreaterThan(0.25);
    expect(wet / 365).toBeLessThan(0.6);
    expect(summerTemp).toBeGreaterThan(winterTemp + 100);
  });
});
