// 模拟玩家 (技术设计 §6): an AI plays the scribe for N days on the fake clock — regression test
// and cost probe in one. Each day it catches the village up, walks to someone awake, talks a
// few turns, and leaves. At the end the residents' lines go to the style judge.

import { calendar, loadPrompt, renderPrompt } from "@elmsford/content";
import { computeGameTime, zonedToInstant } from "@elmsford/core";
import { and, eq, gte } from "drizzle-orm";
import type { ClockService } from "../clock";
import { availability } from "../conversation/context";
import type { ConversationService, StreamEvent } from "../conversation/service";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Simulation } from "../sim/engine";
import { dateShift } from "../sim/days";
import { getVillage } from "../village";
import { getResidents } from "../world/repo";
import { judgeStyle } from "./styleJudge";

export interface SimPlayerOptions {
  days: number;
  /** Talk to someone each day, or just let the village run. */
  talk: boolean;
  turns: number;
}

export interface SimPlayerDay {
  date: string;
  talkedTo: string | null;
  lines: number;
  costUsd: number;
  calls: number;
  newMemories: number;
  happenings: string[];
  error?: string;
}

/** What the run is doing right now, so the page can show it's alive. */
export type SimPlayerStage =
  | { kind: "catching_up"; date: string }
  | { kind: "talking"; date: string; with: string }
  | { kind: "judging" }
  | null;

export interface SimPlayerRun {
  running: boolean;
  stage: SimPlayerStage;
  startedAt: number;
  options: SimPlayerOptions;
  days: SimPlayerDay[];
  totalCostUsd: number;
  style: { score: number; verdict: string } | null;
  error: string | null;
}

let current: SimPlayerRun | null = null;
let cancel = false;

export const simPlayerStatus = () => current;
export const stopSimPlayer = () => {
  cancel = true;
};

const HOURS = [9, 11, 15, 17];

function spend(db: Db, since: number) {
  const rows = db.select().from(t.llmCalls).where(gte(t.llmCalls.startedAt, since)).all();
  return { cost: rows.reduce((s, r) => s + r.costUsd, 0), calls: rows.length };
}

async function playerLine(gateway: LlmGateway, villageId: string, notes: string, transcript: string): Promise<string | null> {
  const r = await gateway.call({
    tier: "cheap",
    purpose: "dev.sim_player",
    villageId,
    system: [{ text: loadPrompt("world"), cache: true }],
    messages: [{ role: "user", content: renderPrompt("sim-player", { notes, transcript }) }],
    maxTokens: 800,
    effort: "low",
  });
  const line = r.text.trim();
  return !line || line.includes("（走开）") ? null : line.slice(0, 300);
}

export function startSimPlayer(
  deps: { db: Db; clock: ClockService; gateway: LlmGateway; sim: Simulation; conversations: ConversationService },
  villageId: string,
  options: SimPlayerOptions,
): SimPlayerRun {
  if (current?.running) return current;
  cancel = false;
  const run: SimPlayerRun = { running: true, stage: null, startedAt: Date.now(), options, days: [], totalCostUsd: 0, style: null, error: null };
  current = run;
  const { db, clock, gateway, sim, conversations } = deps;
  const residentLines: string[] = [];

  void (async () => {
    try {
      // Hold the clock still between steps; the run moves it.
      clock.adjust({ speed: 0 });
      for (let d = 0; d < options.days && !cancel; d++) {
        const v = getVillage(db, villageId)!;
        const today = computeGameTime(clock.now(), v.timeZone, calendar).date;
        const date = dateShift(today, 1);
        const [y, m, dd] = date.split("-").map(Number) as [number, number, number];
        const hour = HOURS[d % HOURS.length]!;
        clock.adjust({ jumpTo: zonedToInstant(y, m, dd, hour, 0, v.timeZone) });
        const since = Date.now();
        const memBefore = db.select().from(t.memories).where(eq(t.memories.villageId, villageId)).all().length;
        const day: SimPlayerDay = { date, talkedTo: null, lines: 0, costUsd: 0, calls: 0, newMemories: 0, happenings: [] };
        run.days.push(day);

        run.stage = { kind: "catching_up", date };
        await sim.advance(villageId);

        if (options.talk) {
          const village = getVillage(db, villageId)!;
          const now = clock.now();
          const people = getResidents(db, villageId);
          const candidates = people.filter((c) => {
            const p = availability(db, { ...village, playerLocationId: c.state.locationId }, c, now, c.state.locationId);
            return p.ok && c.state.locationId !== "kingsbury";
          });
          const who = candidates[d % Math.max(1, candidates.length)];
          if (who) {
            db.update(t.villages).set({ playerLocationId: who.state.locationId }).where(eq(t.villages.id, villageId)).run();
            const fresh = getVillage(db, villageId)!;
            day.talkedTo = who.shortName;
            run.stage = { kind: "talking", date, with: who.shortName };
            const transcript: string[] = [];
            let convId: string | null = null;
            const collect = (e: StreamEvent, acc: { text: string }) => {
              if (e.type === "start") convId = e.conversationId;
              if (e.type === "text") acc.text += e.delta;
              if (e.type === "action") transcript.push(`（${e.text}）`);
              if (e.type === "error") day.error = e.message;
            };
            let acc = { text: "" };
            await conversations.start(fresh, who.id, (e) => collect(e, acc));
            if (acc.text) {
              transcript.push(`${who.shortName}：${acc.text}`);
              residentLines.push(acc.text);
            }
            const notes = db
              .select()
              .from(t.notebook)
              .where(and(eq(t.notebook.villageId, villageId), eq(t.notebook.characterId, who.id)))
              .all()
              .map((n) => `- ${n.text}`)
              .join("\n");
            for (let turn = 0; turn < options.turns && convId && !cancel; turn++) {
              const conv = conversations.get(convId);
              if (!conv || conv.endedAt) break;
              const line = await playerLine(gateway, villageId, notes || "（还没记过什么）", transcript.join("\n"));
              if (!line) break;
              transcript.push(`抄写员：${line}`);
              acc = { text: "" };
              await conversations.say(getVillage(db, villageId)!, convId, line, (e) => collect(e, acc));
              if (acc.text) {
                transcript.push(`${who.shortName}：${acc.text}`);
                residentLines.push(acc.text);
              }
              day.lines += 2;
            }
            if (convId) await conversations.end(getVillage(db, villageId)!, convId, "player");
            // Give extraction a moment; it runs in the background.
            await new Promise((r) => setTimeout(r, 1500));
          }
        }

        const s = spend(db, since);
        day.costUsd = s.cost;
        day.calls = s.calls;
        day.newMemories = db.select().from(t.memories).where(eq(t.memories.villageId, villageId)).all().length - memBefore;
        day.happenings = db
          .select()
          .from(t.villageDays)
          .where(and(eq(t.villageDays.villageId, villageId), eq(t.villageDays.date, date)))
          .all()
          .flatMap((r) => r.happenings.map((h) => h.text));
        run.totalCostUsd = run.days.reduce((sum, x) => sum + x.costUsd, 0);
      }

      if (residentLines.length) {
        run.stage = { kind: "judging" };
        const sample = residentLines.slice(-12).join("\n\n");
        const since = Date.now();
        const judged = await judgeStyle(gateway, sample, villageId);
        run.style = { score: judged.data.score, verdict: judged.data.verdict };
        run.totalCostUsd += spend(db, since).cost;
      }
    } catch (err) {
      run.error = err instanceof Error ? err.message : String(err);
    } finally {
      run.running = false;
      run.stage = null;
    }
  })();
  return run;
}

