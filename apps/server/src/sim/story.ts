// 按自己的步子过 (story mode): the village's clock moves only when the player does something.
// Walking, talking and writing each take a while; resting skips to the next stretch of the day;
// when the evening is over the player goes home to bed and wakes up the next morning. Someone
// coming to find the player cuts a rest short — they still come looking for you (设定圣经 §5.7).

import { calendar, storyDay } from "@elmsford/content";
import { bellsRung, chineseNumeral, computeGameTime, fromHHMM, nextStorySegment, PLAYER_ID, storySegmentAt, zonedToInstant, type BellId, type GameTime } from "@elmsford/core";
import { and, eq, isNull } from "drizzle-orm";
import type { ClockService } from "../clock";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { Village } from "../village";
import { dayBlocks } from "../world/presence";
import { getResidents } from "../world/repo";
import { startRecap } from "./recap";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const segments = storyDay.segments;

export interface Passed {
  /** Bells that rang meanwhile. */
  bells: BellId[];
  /** The evening is over. */
  night: boolean;
}

export type RestUntil = "segment" | "day";

/** How long a stretch of talk took, from how much was said. */
export function talkMinutes(...said: string[]): number {
  const chars = said.reduce((n, s) => n + s.replace(/\s/g, "").length, 0);
  return Math.max(1, Math.ceil(chars / storyDay.talkCharsPerMinute));
}

/** "过了小半个钟头。" — time gone by while doing something, in the player's view. */
export function passedText(minutes: number): string {
  if (minutes < 15) return "过了一会儿。";
  if (minutes < 45) return "过了小半个钟头。";
  if (minutes < 90) return "过了个把钟头。";
  const hours = Math.round(minutes / 60);
  return `过了${hours === 2 ? "两" : chineseNumeral(hours)}个钟头。`;
}

/** The instant at a minute of the given game day. */
function at(gt: GameTime, minuteOfDay: number): number {
  return zonedToInstant(gt.year, gt.month, gt.day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, gt.timeZone);
}

export class StoryTime {
  private note: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: ClockService,
    /** Time moved on: let the village catch up. */
    private readonly onPassed: (villageId: string) => void,
  ) {}

  active(village: Village): boolean {
    return village.timeMode === "story" && village.startedAt !== null;
  }

  private gt(village: Village, instant = this.clock.now()) {
    return computeGameTime(instant, village.timeZone, calendar);
  }

  /** What happened to the player that the place doesn't show by itself (once). */
  takeNote(): string | null {
    const n = this.note;
    this.note = null;
    return n;
  }

  /** Something took `minutes`. */
  pass(village: Village, minutes: number): Passed {
    if (!this.active(village) || minutes <= 0) return { bells: [], night: false };
    const before = this.gt(village);
    const after = this.gt(village, before.instant + minutes * MINUTE);
    const bells = bellsRung(before.bells.today, before.minuteOfDay, after.date === before.date ? after.minuteOfDay : 24 * 60);
    this.clock.setStory(after.instant);
    this.onPassed(village.id);
    return { bells, night: storySegmentAt(segments, after.minuteOfDay) === null };
  }

  /** The next morning after `instant` (this morning, if it's still before dawn). */
  private nextMorning(village: Village, instant: number): number {
    const gt = this.gt(village, instant);
    const morning = at(gt, segments[0]!.from);
    return gt.minuteOfDay < segments[0]!.from ? morning : this.gt(village, morning + DAY).instant;
  }

  private sleep(village: Village, from: number, note: string | null) {
    this.db.update(t.villages).set({ playerLocationId: "player_house" }).where(eq(t.villages.id, village.id)).run();
    this.clock.setStory(this.nextMorning(village, from));
    this.note = note;
    this.onPassed(village.id);
  }

  /** The evening is over and nothing is keeping the player up: home to bed, and it's morning. */
  settle(village: Village): boolean {
    if (!this.active(village)) return false;
    const gt = this.gt(village);
    if (storySegmentAt(segments, gt.minuteOfDay)) return false;
    const talking = this.db.select().from(t.conversations).where(and(eq(t.conversations.villageId, village.id), isNull(t.conversations.endedAt))).get();
    if (talking) return false;
    this.sleep(village, gt.instant, "天黑透了，你回家睡下。");
    return true;
  }

  /**
   * Someone whose plan today is to come and find the player where they'll be waiting, between
   * now and `until`. The first of them, and when they get there.
   */
  private visitor(village: Village, where: string, until: number): { name: string; at: number } | null {
    const gt = this.gt(village);
    const end = this.gt(village, until);
    const last = end.date === gt.date ? end.minuteOfDay : 24 * 60;
    let first: { name: string; at: number } | null = null;
    for (const c of getResidents(this.db, village.id)) {
      for (const b of dayBlocks(this.db, village.id, c, gt).blocks) {
        const from = fromHHMM(b.from) ?? -1;
        if (b.locationId !== where || b.asleep || !b.intent || !b.withIds?.includes(PLAYER_ID)) continue;
        if (from <= gt.minuteOfDay || from >= last) continue;
        const arrives = at(gt, from) + MINUTE;
        if (!first || arrives < first.at) first = { name: c.shortName, at: arrives };
      }
    }
    return first;
  }

  /** Rest here until the next stretch of the day, or let the rest of today go (home, and to bed). */
  rest(village: Village, until: RestUntil): void {
    if (!this.active(village)) return;
    const gt = this.gt(village);
    const segment = storySegmentAt(segments, gt.minuteOfDay);
    if (!segment) return this.sleep(village, gt.instant, null);
    const next = nextStorySegment(segments, segment);
    const toBed = until === "day" || !next;
    if (toBed) this.db.update(t.villages).set({ playerLocationId: "player_house" }).where(eq(t.villages.id, village.id)).run();
    const where = toBed ? "player_house" : village.playerLocationId;
    const target = at(gt, toBed ? segments.at(-1)!.to : next!.from);

    const visitor = this.visitor(village, where, target);
    if (visitor) {
      this.clock.setStory(visitor.at);
      this.note = `${visitor.name}来找你了。`;
      this.onPassed(village.id);
      return;
    }
    if (!toBed) {
      this.clock.setStory(target);
      this.onPassed(village.id);
      return;
    }
    // A day let go by gets its "这几天", like coming back after a while.
    if (until === "day") startRecap(this.db, village, gt.instant, this.nextMorning(village, target), "rested");
    this.sleep(village, target, null);
  }
}
