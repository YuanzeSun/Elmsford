import { adjustFakeClock, fakeNow, type Clock, type FakeClockState } from "@elmsford/core";
import { eq } from "drizzle-orm";
import { LOCAL_VILLAGE_ID } from "./config";
import type { Db } from "./db/client";
import { meta, villages } from "./db/schema";

const META_KEY = "dev_clock";

export interface ClockInfo {
  /** "story": the village keeps its own time, moved only by what the player does. */
  mode: "real" | "fake" | "story";
  speed: number;
  now: number;
}

/**
 * The game clock. A village in story mode has its own (stored with the village, moved by
 * StoryTime); otherwise real time, unless dev mode has installed a fake clock. The fake clock
 * survives server restarts (it lives in the meta table) but is ignored entirely outside dev mode.
 */
export class ClockService implements Clock {
  private fake: FakeClockState | null = null;

  constructor(
    private readonly db: Db,
    private readonly devMode: boolean,
  ) {
    if (devMode) {
      const row = db.select().from(meta).where(eq(meta.key, META_KEY)).get();
      this.fake = (row?.value as FakeClockState | undefined) ?? null;
    }
  }

  /** The village's own clock, when it keeps one. */
  private story(): number | null {
    const v = this.db.select({ mode: villages.timeMode, at: villages.storyAt, started: villages.startedAt }).from(villages).where(eq(villages.id, LOCAL_VILLAGE_ID)).get();
    return v?.started && v.mode === "story" ? (v.at ?? null) : null;
  }

  /** The clock outside the village: real time, or the dev clock. What a new village starts from. */
  outside(): number {
    return this.fake ? fakeNow(this.fake, Date.now()) : Date.now();
  }

  now(): number {
    return this.story() ?? this.outside();
  }

  info(): ClockInfo {
    const story = this.story();
    if (story !== null) return { mode: "story", speed: 0, now: story };
    return { mode: this.fake ? "fake" : "real", speed: this.fake?.speed ?? 1, now: this.now() };
  }

  /** Story mode: move the village's clock on. Never backwards. */
  setStory(at: number) {
    const current = this.story();
    if (current === null || at <= current) return;
    this.db.update(villages).set({ storyAt: Math.round(at) }).where(eq(villages.id, LOCAL_VILLAGE_ID)).run();
  }

  adjust(change: { speed?: number; jumpTo?: number }): ClockInfo {
    if (!this.devMode) throw new Error("fake clock is dev-mode only");
    if (this.story() !== null) {
      // A story village has no speed; a jump moves its clock forward.
      if (change.jumpTo !== undefined) this.setStory(change.jumpTo);
      return this.info();
    }
    this.fake = adjustFakeClock(this.fake, Date.now(), change);
    this.db
      .insert(meta)
      .values({ key: META_KEY, value: this.fake })
      .onConflictDoUpdate({ target: meta.key, set: { value: this.fake } })
      .run();
    return this.info();
  }

  useRealTime(): ClockInfo {
    this.fake = null;
    this.db.delete(meta).where(eq(meta.key, META_KEY)).run();
    return this.info();
  }
}
