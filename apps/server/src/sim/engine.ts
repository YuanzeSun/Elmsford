// The simulation loop and catch-up (技术设计 §4.3, §4.4). The village keeps a cursor
// (simulatedUntil); each advance brings it up to the present, in steps sized by how far behind it is:
//   behind < ~1 day  → hour by hour (in 4-hour chunks when catching up), with encounters
//   1–8 days         → a summary per day
//   > 8 days         → a summary per week, then per day
// Every step saves the cursor, so catch-up can stop at any point and pick up where it left off.
// The player never waits for it: the village is playable while it runs.

import { calendar, DRAW_MAPS } from "@elmsford/content";
import { computeGameTime, PLAYER_ID, type Clock } from "@elmsford/core";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { LlmError, type LlmGateway } from "../llm/gateway";
import { deliverReplies, dispatchLetters } from "../scribe/letters";
import { getVillage, type Village } from "../village";
import { drawMap } from "../world/map";
import { syncPresence } from "../world/presence";
import { dateShift, ensureDay, settleDay, startOfDate } from "./days";
import { findEncounters, resolveEncounters, type Encounter } from "./encounters";
import { considerArrival, considerSteppingForward, welcome } from "./newcomers";
import { planDay } from "./planner";
import { buildRecap, pendingRecap, RECAP_AFTER_MS, startRecap } from "./recap";
import { reflectWeek } from "./reflection";
import { summarize } from "./summaries";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MIN_STEP = 15 * MINUTE;
/** The player counts as present if their client checked in this recently (real time). */
const ONLINE_WINDOW_MS = 90_000;

export interface SimStatus {
  running: boolean;
  simulatedUntil: number | null;
  behindMs: number;
  mode: string | null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class Simulation {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly modes = new Map<string, string>();
  private readonly pings = new Map<string, number>();
  private readonly listening = new Set<string>();
  /** Map drawing per village, so it isn't started twice or asked again after giving up. */
  private readonly mapState = new Map<string, "drawing" | "gave-up">();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly gateway: LlmGateway,
  ) {}

  /**
   * The client checked in. A long gap since the last check-in (game time) means the player was
   * away — tab closed, laptop asleep, or a dev-clock jump — and earns a "这几天".
   */
  ping(villageId: string) {
    const now = this.clock.now();
    const v = getVillage(this.db, villageId);
    // A story village doesn't move while the player is away; there's nothing to come back to.
    const away = v?.timeMode === "real" && v.lastSeenAt != null && now - v.lastSeenAt >= RECAP_AFTER_MS;
    if (away && !pendingRecap(this.db, villageId)) startRecap(this.db, v, v.lastSeenAt!, now);
    this.pings.set(villageId, Date.now());
    this.db.update(t.villages).set({ lastSeenAt: now }).where(eq(t.villages.id, villageId)).run();
  }

  online(villageId: string): boolean {
    return Date.now() - (this.pings.get(villageId) ?? 0) < ONLINE_WINDOW_MS;
  }

  status(villageId: string): SimStatus {
    const v = getVillage(this.db, villageId);
    const until = v?.simulatedUntil ?? null;
    return {
      running: this.locks.has(villageId),
      simulatedUntil: until,
      behindMs: until === null ? 0 : Math.max(0, this.clock.now() - until),
      mode: this.modes.get(villageId) ?? null,
    };
  }

  /**
   * A new village gets its map drawn in the background, apart from the clock: one drawing at a
   * time (it takes its own few tries). When the model can't draw a valid one, the fallback stays;
   * only a failed call (relay down, over budget) is tried again on a later tick.
   */
  private drawMapOnce(villageId: string) {
    if (!DRAW_MAPS) return;
    const village = getVillage(this.db, villageId);
    if (!village || village.map || this.mapState.has(villageId)) return;
    this.mapState.set(villageId, "drawing");
    drawMap(this.db, this.gateway, villageId).then(
      (drawn) => (drawn ? this.mapState.delete(villageId) : this.mapState.set(villageId, "gave-up")),
      (err: unknown) => {
        if (!(err instanceof LlmError && err.kind === "over_budget")) console.error("[sim] map failed, will retry:", errorText(err));
        this.mapState.delete(villageId);
      },
    );
  }

  /** Wait for a run in progress to finish (before the village is taken away). */
  async settle(villageId: string): Promise<void> {
    await this.locks.get(villageId)?.catch(() => {});
  }

  /** Forget per-village state after the village was replaced. */
  forget(villageId: string) {
    this.mapState.delete(villageId);
    this.pings.delete(villageId);
  }

  /** Bring the village up to now. Concurrent callers share the run in progress. */
  advance(villageId: string): Promise<void> {
    this.drawMapOnce(villageId);
    const running = this.locks.get(villageId);
    if (running) return running;
    const run = this.run(villageId).finally(() => {
      this.locks.delete(villageId);
      this.modes.delete(villageId);
    });
    this.locks.set(villageId, run);
    return run;
  }

  private setCursor(villageId: string, at: number) {
    this.db.update(t.villages).set({ simulatedUntil: at }).where(eq(t.villages.id, villageId)).run();
  }

  private async run(villageId: string) {
    let village = getVillage(this.db, villageId);
    // Nothing happens until the player has walked in.
    if (!village?.startedAt) return;
    const now = this.clock.now();
    if (village.simulatedUntil === null) {
      // A brand-new village starts now; there is nothing behind it.
      this.setCursor(villageId, now);
      village = getVillage(this.db, villageId)!;
      await this.ensurePlanned(village, computeGameTime(now, village.timeZone, calendar).date);
      return;
    }

    let cursor = village.simulatedUntil;
    while (this.clock.now() - cursor >= MIN_STEP) {
      village = getVillage(this.db, villageId)!;
      // Whoever's time has come joins before the next stretch is simulated.
      await this.background(() => welcome(this.db, this.gateway, village!, cursor), "newcomers");
      const target = this.clock.now();
      const date = computeGameTime(cursor, village.timeZone, calendar).date;
      const dayStart = startOfDate(village, date);
      const nextDay = startOfDate(village, dateShift(date, 1));
      const gap = target - cursor;

      if (gap > 8 * DAY && cursor === dayStart) {
        this.modes.set(villageId, `week ${date}`);
        await this.background(() => summarize(this.db, this.gateway, village!, date, 7), `week summary ${date}`);
        for (let i = 0; i < 7; i++) await this.endOfDay(village, dateShift(date, i));
        cursor = startOfDate(village, dateShift(date, 7));
      } else if (gap > 26 * HOUR) {
        this.modes.set(villageId, `day ${date}`);
        await this.background(() => summarize(this.db, this.gateway, village!, date, 1), `day summary ${date}`);
        await this.endOfDay(village, date);
        cursor = nextDay;
      } else {
        this.modes.set(villageId, `hours ${date}`);
        await this.ensurePlanned(village, date);
        const live = gap <= 2 * HOUR;
        const end = Math.min(cursor + (live ? HOUR : 4 * HOUR), nextDay, target);
        if (end - cursor < MIN_STEP) break;
        const encounters: Encounter[] = [];
        const playerAt = this.online(villageId) ? village.playerLocationId : null;
        for (let h = cursor; h < end; h += HOUR) encounters.push(...findEncounters(this.db, village, h, { playerAt }));
        await this.background(() => resolveEncounters(this.db, this.gateway, village!, encounters), `encounters ${date}`);
        cursor = end;
        if (cursor === nextDay) await this.endOfDay(village, date);
      }
      this.setCursor(villageId, cursor);
    }

    village = getVillage(this.db, villageId)!;
    await this.background(() => welcome(this.db, this.gateway, village!, cursor), "newcomers");
    const presences = syncPresence(this.db, villageId, this.clock.now(), village.timeZone);
    if (this.online(villageId)) this.knock(village, presences);
    const recap = pendingRecap(this.db, villageId);
    if (recap) await this.background(() => buildRecap(this.db, this.gateway, village!, recap), "recap");
  }

  /** Someone came to the door while the player is home: let them know, once per visit. */
  private knock(village: Village, presences: ReturnType<typeof syncPresence>) {
    if (village.playerLocationId !== "player_house") return;
    const now = this.clock.now();
    const hour = computeGameTime(now, village.timeZone, calendar);
    for (const p of presences) {
      if (p.block.locationId !== "player_house" || p.asleep || !p.block.intent || !p.block.withIds?.includes(PLAYER_ID)) continue;
      const id = `knock:${village.id}:${hour.date}:${p.block.from}:${p.character.id}`;
      this.db
        .insert(t.notifications)
        .values({ id, villageId: village.id, at: now, characterId: p.character.id, text: `${p.character.shortName}在敲你的门` })
        .onConflictDoNothing()
        .run();
    }
  }

  /** Background LLM work never blocks the clock: on failure the village carries on by its routines. */
  private async background(work: () => Promise<unknown>, label: string) {
    try {
      await work();
    } catch (err) {
      if (err instanceof LlmError && err.kind === "over_budget") return;
      console.error(`[sim] ${label} failed, carrying on by routine:`, errorText(err));
    }
  }

  private async ensurePlanned(village: Village, date: string) {
    const day = ensureDay(this.db, village, date);
    if (!day.planned) await this.background(() => planDay(this.db, this.gateway, village, date), `plan ${date}`);
  }

  /** Rules, the carrier on Thursdays, reflection on Sundays; and whether anyone joins tomorrow. */
  private async endOfDay(village: Village, date: string) {
    settleDay(this.db, village, date);
    const evening = startOfDate(village, date) + 19 * HOUR;
    const gt = computeGameTime(evening, village.timeZone, calendar);
    const now = this.clock.now();
    if (gt.weekday === 0) considerSteppingForward(this.db, village, date, now);
    considerArrival(this.db, village, date, now);
    if (gt.weekday === 4) {
      await this.background(() => deliverReplies(this.db, this.gateway, village, evening), "deliver replies");
      await this.background(() => dispatchLetters(this.db, this.gateway, village, evening), "dispatch letters");
    }
    if (gt.weekday === 0) await this.background(() => reflectWeek(this.db, this.gateway, village, startOfDate(village, dateShift(date, 1))), "reflection");
  }

  /**
   * The player just walked into a place with people in it: resolve what's going on there now,
   * so they can overhear it. Runs in the background; the place view picks up the lines.
   */
  async listen(villageId: string, locationId: string): Promise<void> {
    const key = `${villageId}:${locationId}`;
    if (this.listening.has(key)) return;
    this.listening.add(key);
    try {
      const village = getVillage(this.db, villageId);
      if (!village) return;
      const now = this.clock.now();
      const hourStart = now - (now % HOUR);
      const encounters = findEncounters(this.db, village, hourStart, { playerAt: locationId, onlyAt: locationId, force: true, at: now });
      await this.background(() => resolveEncounters(this.db, this.gateway, village, encounters), "listen");
    } finally {
      this.listening.delete(key);
    }
  }
}
