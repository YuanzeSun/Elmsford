// Daily planning (技术设计 §4.3 layer 1). One planner call plans every resident's waking day —
// batched because each call through the relay carries a large fixed overhead. Whatever comes
// back is checked like any other LLM proposal: known places only, times clipped to waking
// hours, gaps filled from the routine. Sleep stays where the routine puts it.

import { calendar, customs, loadPrompt, locations, renderPrompt } from "@elmsford/content";
import { computeGameTime, describeTime, fromHHMM, PLAYER_ID, routineForDay, toHHMM, type GameTime, type PlanBlock } from "@elmsford/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { getResidents, type CharacterRow } from "../world/repo";
import { placeList, residentBrief } from "./brief";
import { customsForPlanning } from "./customs";
import { ensureDay, startOfDate } from "./days";

const PlanSchema = z.object({
  residents: z.array(
    z.object({
      id: z.string(),
      mood: z.string(),
      blocks: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          locationId: z.string(),
          activity: z.string(),
          withIds: z.array(z.string()),
          intent: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const PLANNABLE = new Set(locations.map((l) => l.id));
/** A failed plan is retried on later steps (about hourly); after this many tries the day runs on routines. */
const MAX_PLAN_ATTEMPTS = 3;
const failedAttempts = new Map<string, number>();

export function dayText(db: Db, village: Village, date: string): { gt: GameTime; text: string } {
  const day = ensureDay(db, village, date);
  const gt = computeGameTime(startOfDate(village, date) + 12 * 3_600_000, village.timeZone, calendar);
  const desc = describeTime(gt, calendar);
  const head = desc.headline.split("，")[0]!;
  const lines = [
    `${desc.dateText}，${desc.weekday}，${head}。${desc.season}。${gt.liturgical.holyDay ? "今天要望弥撒，不干重活。" : ""}${desc.fasting}`,
    `天气：${day.weather.text}`,
    `日出 ${desc.sunrise}，日落 ${desc.sunset}。`,
    `这时节村里在忙：${desc.agrarian.join("，")}。`,
    ...customsForPlanning(gt, new Map(getResidents(db, village.id).map((c) => [c.id, c.shortName]))),
    // Feasts without a written custom still carry their note.
    ...gt.liturgical.feasts
      .filter((f) => f.note && !customs.some((c) => "feast" in c.when && c.when.feast === f.id))
      .map((f) => `今天是${f.name}：${f.note}。`),
    ...(gt.weekday === 4 ? ["今天是金斯伯里的集日，有人会去赶集，商贩会捎信。"] : []),
    ...day.happenings.map((h) => `今天出了件事：${h.text}。`),
  ];
  return { gt, text: lines.join("\n") };
}

function routineBlocks(c: CharacterRow, gt: GameTime): PlanBlock[] {
  return routineForDay(c.routine, gt, { locationId: c.seed.homeId, activity: "在家" });
}

function wakingWindow(blocks: PlanBlock[]): [number, number] {
  const firstAwake = blocks.findIndex((b) => !b.asleep);
  const lastAwake = blocks.length - 1 - [...blocks].reverse().findIndex((b) => !b.asleep);
  return [fromHHMM(blocks[firstAwake]?.from ?? "06:00") ?? 360, fromHHMM(blocks[lastAwake]?.to ?? "21:00") ?? 1260];
}

/** Clean a proposed day: only valid blocks inside waking hours, gaps filled from the routine. */
export function repairPlan(proposed: z.infer<typeof PlanSchema>["residents"][number]["blocks"], routine: PlanBlock[], knownIds: Set<string>): PlanBlock[] {
  const [wake, bed] = wakingWindow(routine);
  const clean: { from: number; to: number; b: PlanBlock }[] = [];
  for (const p of proposed) {
    const from = Math.max(wake, fromHHMM(p.from) ?? -1);
    const to = Math.min(bed, fromHHMM(p.to) ?? -1);
    if (to - from < 10 || !PLANNABLE.has(p.locationId) || !p.activity.trim()) continue;
    if (clean.some((c) => from < c.to && to > c.from)) continue; // overlaps an earlier block
    const withIds = p.withIds.filter((id) => id === PLAYER_ID || knownIds.has(id));
    clean.push({
      from,
      to,
      b: {
        from: toHHMM(from),
        to: toHHMM(to),
        locationId: p.locationId,
        activity: p.activity.trim().slice(0, 60),
        ...(withIds.length ? { withIds } : {}),
        ...(p.intent?.trim() ? { intent: p.intent.trim().slice(0, 100) } : {}),
      },
    });
  }
  clean.sort((a, b) => a.from - b.from);

  // Fill every gap (and the night) from the routine.
  const out: PlanBlock[] = [];
  const fillFromRoutine = (from: number, to: number) => {
    for (const r of routine) {
      const rf = fromHHMM(r.from)!;
      const rt = fromHHMM(r.to)!;
      const f = Math.max(from, rf);
      const e = Math.min(to, rt);
      if (e > f) out.push({ ...r, from: toHHMM(f), to: toHHMM(e) });
    }
  };
  let cursor = 0;
  for (const c of clean) {
    if (c.from > cursor) fillFromRoutine(cursor, c.from);
    out.push(c.b);
    cursor = c.to;
  }
  fillFromRoutine(cursor, 1440);
  return out;
}

export async function planDay(db: Db, gateway: LlmGateway, village: Village, date: string): Promise<boolean> {
  const day = ensureDay(db, village, date);
  if (day.planned) return false;
  const { gt, text } = dayText(db, village, date);
  const residents = getResidents(db, village.id);
  const knownIds = new Set(residents.map((c) => c.id));
  const now = startOfDate(village, date) + 5 * 3_600_000;

  const residentText = residents
    .map((c) => {
      const routine = routineBlocks(c, gt);
      const [wake, bed] = wakingWindow(routine);
      const usual = routine.filter((b) => !b.asleep).map((b) => `${b.from}-${b.to} ${b.locationId} ${b.activity}`).join("；");
      return `${residentBrief(db, village, c, { now })}\n醒着的时间：${toHHMM(wake)} 到 ${toHHMM(bed)}\n平常这样的日子：${usual}`;
    })
    .join("\n\n");

  let plans: z.infer<typeof PlanSchema>["residents"] = [];
  try {
    const r = await gateway.callJson(
      {
        tier: "planner",
        purpose: "sim.plan_day",
        villageId: village.id,
        background: true,
        system: [{ text: loadPrompt("world"), cache: true }],
        messages: [{ role: "user", content: renderPrompt("planner", { day: text, places: placeList(), residents: residentText }) }],
        maxTokens: 8000,
        effort: "low",
        cacheKey: `elmsford.plan.${village.id}`,
      },
      "day_plans",
      PlanSchema,
    );
    plans = r.data.residents;
  } catch (err) {
    const key = `${village.id}:${date}`;
    const tries = (failedAttempts.get(key) ?? 0) + 1;
    failedAttempts.set(key, tries);
    // Until then the day isn't marked planned; residents follow their routines meanwhile.
    if (tries < MAX_PLAN_ATTEMPTS) throw err;
    console.error(`planning ${date} failed ${tries} times, using routines:`, err instanceof Error ? err.message : err);
  }

  db.transaction((tx) => {
    for (const c of residents) {
      const routine = routineBlocks(c, gt);
      const proposal = plans.find((p) => p.id === c.id);
      const blocks = proposal ? repairPlan(proposal.blocks, routine, knownIds) : routine;
      tx.insert(t.dayPlans)
        .values({ villageId: village.id, characterId: c.id, date, blocks })
        .onConflictDoUpdate({ target: [t.dayPlans.villageId, t.dayPlans.characterId, t.dayPlans.date], set: { blocks } })
        .run();
      if (proposal?.mood.trim()) {
        tx.update(t.characters)
          .set({ state: { ...c.state, mood: proposal.mood.trim().slice(0, 12) } })
          .where(and(eq(t.characters.villageId, village.id), eq(t.characters.id, c.id)))
          .run();
      }
    }
    tx.update(t.villageDays).set({ planned: true }).where(and(eq(t.villageDays.villageId, village.id), eq(t.villageDays.date, date))).run();
  });
  return true;
}
