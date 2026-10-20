import { describe, expect, it } from "vitest";
import {
  adjustFakeClock,
  adventSundayDayNumber,
  chineseDate,
  chineseNumeral,
  dayNumber,
  easterDayNumber,
  fakeNow,
  formatClock,
  fromDayNumber,
  standardOffsetMinutes,
  sunTimes,
  weekdayOf,
  zonedParts,
  zonedToInstant,
} from "../src";

describe("dates", () => {
  it("computes Gregorian Easter", () => {
    expect(fromDayNumber(easterDayNumber(2025))).toEqual({ year: 2025, month: 4, day: 20 });
    expect(fromDayNumber(easterDayNumber(2026))).toEqual({ year: 2026, month: 4, day: 5 });
    expect(fromDayNumber(easterDayNumber(2027))).toEqual({ year: 2027, month: 3, day: 28 });
    expect(fromDayNumber(easterDayNumber(2038))).toEqual({ year: 2038, month: 4, day: 25 });
  });

  it("finds the first Sunday of Advent", () => {
    expect(fromDayNumber(adventSundayDayNumber(2026))).toEqual({ year: 2026, month: 11, day: 29 });
    expect(fromDayNumber(adventSundayDayNumber(2027))).toEqual({ year: 2027, month: 11, day: 28 });
  });

  it("knows weekdays", () => {
    expect(weekdayOf(dayNumber(2026, 10, 20))).toBe(2); // Tuesday
    expect(weekdayOf(dayNumber(1970, 1, 1))).toBe(4);
  });
});

describe("sun at 52°N", () => {
  it("has long summer days and short winter days", () => {
    const june = sunTimes(2026, 6, 21);
    const december = sunTimes(2026, 12, 21);
    expect(june.dayLength / 60).toBeCloseTo(16.6, 0);
    expect(december.dayLength / 60).toBeCloseTo(7.8, 0);
    expect(june.civilDawn).toBeLessThan(june.sunrise);
    expect(december.civilDusk).toBeGreaterThan(december.sunset);
  });

  it("puts solar noon near 12:00 standard time", () => {
    for (const month of [1, 4, 7, 10]) {
      expect(Math.abs(sunTimes(2026, month, 15).solarNoon - 720)).toBeLessThan(17);
    }
  });
});

describe("time zones", () => {
  it("reads wall-clock parts and offsets", () => {
    const instant = Date.UTC(2026, 9, 20, 8, 5); // 16:05 in Shanghai
    expect(zonedParts(instant, "Asia/Shanghai")).toMatchObject({ hour: 16, minute: 5, offsetMinutes: 480 });
    expect(zonedParts(instant, "Europe/London")).toMatchObject({ hour: 9, offsetMinutes: 60 });
  });

  it("round-trips local time to an instant", () => {
    const t = zonedToInstant(2026, 10, 28, 18, 30, "Europe/London");
    expect(zonedParts(t, "Europe/London")).toMatchObject({ month: 10, day: 28, hour: 18, minute: 30 });
  });

  it("finds the standard offset regardless of hemisphere", () => {
    expect(standardOffsetMinutes(2026, "Europe/London")).toBe(0);
    expect(standardOffsetMinutes(2026, "Australia/Sydney")).toBe(600);
    expect(standardOffsetMinutes(2026, "Asia/Shanghai")).toBe(480);
  });
});

describe("fake clock", () => {
  it("runs at speed and re-anchors on change", () => {
    const start = adjustFakeClock(null, 1_000, { speed: 60 });
    expect(fakeNow(start, 2_000)).toBe(1_000 + 60_000);

    const paused = adjustFakeClock(start, 2_000, { speed: 0 });
    expect(fakeNow(paused, 99_000)).toBe(61_000);

    const jumped = adjustFakeClock(paused, 5_000, { jumpTo: 10_000_000 });
    expect(fakeNow(jumped, 6_000)).toBe(10_000_000);
  });
});

describe("formatting", () => {
  it("writes Chinese numerals", () => {
    expect(chineseNumeral(2)).toBe("二");
    expect(chineseNumeral(10)).toBe("十");
    expect(chineseNumeral(13)).toBe("十三");
    expect(chineseNumeral(20)).toBe("二十");
    expect(chineseNumeral(47)).toBe("四十七");
    expect(chineseNumeral(105)).toBe("一百零五");
    expect(chineseNumeral(118)).toBe("一百一十八");
  });

  it("writes dates without the year", () => {
    expect(chineseDate(10, 20)).toBe("十月二十日");
    expect(chineseDate(1, 6)).toBe("一月六日");
  });

  it("formats clock minutes", () => {
    expect(formatClock(965.6)).toBe("16:06");
    expect(formatClock(-10)).toBe("23:50");
  });
});
