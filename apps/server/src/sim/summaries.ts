// Catch-up summaries (技术设计 §4.4): for a day or a week nobody was watching, one call
// tells what the village roughly did. The result goes through the validator like everything else.

import { calendar, loadPrompt, renderPrompt } from "@elmsford/content";
import { chineseDate, computeGameTime, describeTime, INTERACTION_LIMITS, PLAYER_ID, type ValidationLimits } from "@elmsford/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import type { Village } from "../village";
import { getCharacters, getKnownFacts, getResidents, logEvent, validateAndApply } from "../world/repo";
import { FactIds, residentBrief } from "./brief";
import { dateShift, ensureDay, startOfDate } from "./days";
import { ownNews, socialDelta } from "./encounters";

const SummarySchema = z.object({
  days: z.array(z.object({ characterId: z.string(), text: z.string() })),
  memories: z.array(z.object({ characterId: z.string(), text: z.string(), importance: z.number().int(), participants: z.array(z.string()) })),
  shared: z.array(z.object({ factId: z.string(), tellerId: z.string(), hearerId: z.string() })),
  news: z.array(z.object({ tellerId: z.string(), hearerId: z.string(), text: z.string() })),
  relationships: z.array(z.object({ from: z.string(), to: z.string(), trustDelta: z.number().int(), affectionDelta: z.number().int() })),
  concerns: z.array(z.object({ characterId: z.string(), add: z.array(z.string()), remove: z.array(z.string()) })),
  public: z.array(z.string()),
  forPlayer: z.array(z.object({ characterId: z.string(), item: z.string().nullable(), qty: z.number().int().nullable(), message: z.string().nullable() })),
  moods: z.array(z.object({ characterId: z.string(), mood: z.string() })),
});

const DAY_LIMITS: ValidationLimits = { ...INTERACTION_LIMITS, maxMemories: 10, maxFacts: 8, maxCommitments: 0 };
const WEEK_LIMITS: ValidationLimits = { ...INTERACTION_LIMITS, maxMemories: 12, maxFacts: 10, maxCommitments: 0 };

/** Summarize `days` consecutive days starting at `date` (1 = a day summary, 7 = a week). */
export async function summarize(db: Db, gateway: LlmGateway, village: Village, date: string, days: number): Promise<void> {
  const dates = Array.from({ length: days }, (_, i) => dateShift(date, i));
  const records = dates.map((d) => ensureDay(db, village, d));
  const start = startOfDate(village, date);
  const end = startOfDate(village, dateShift(date, days));
  const mid = start + (end - start) / 2;
  const gtStart = computeGameTime(start + 12 * 3_600_000, village.timeZone, calendar);
  const gtEnd = computeGameTime(end - 12 * 3_600_000, village.timeZone, calendar);

  const md = (d: string) => chineseDate(Number(d.slice(5, 7)), Number(d.slice(8, 10)));
  const period =
    days === 1
      ? `${md(date)}，${describeTime(gtStart, calendar).weekday}。${describeTime(gtStart, calendar).headline.split("，")[0]}。天气：${records[0]!.weather.text}`
      : `${md(date)} 到 ${md(dates.at(-1)!)}，一周。从${describeTime(gtStart, calendar).headline.split("，")[0]!.replace("今天是", "")}到${describeTime(gtEnd, calendar).headline.split("，")[0]!.replace("今天是", "")}。天气大致：${[...new Set(records.map((r) => r.weather.sky))].join("、")}`;
  const happenings = records.flatMap((r) => r.happenings.map((h) => `${md(r.date)}：${h.text}`));
  const feasts = dates.flatMap((d) => {
    const g = computeGameTime(startOfDate(village, d) + 12 * 3_600_000, village.timeZone, calendar);
    return g.liturgical.feasts.filter((f) => f.rank !== "minor").map((f) => `${d}：${f.name}${f.note ? `（${f.note}）` : ""}`);
  });

  const facts = new FactIds();
  const residents = getResidents(db, village.id);
  const residentText = residents.map((c) => residentBrief(db, village, c, { now: start, facts, memoryLimit: 4, factLimit: 5 })).join("\n\n");

  const r = await gateway.callJson(
    {
      tier: days > 1 ? "planner" : "cheap",
      purpose: days > 1 ? "sim.week_summary" : "sim.day_summary",
      villageId: village.id,
      background: true,
      system: [{ text: loadPrompt("world"), cache: true }],
      messages: [
        {
          role: "user",
          content: renderPrompt("day-summary", {
            period,
            happenings: [...happenings, ...feasts].map((h) => `- ${h}`).join("\n") || "- 没什么特别的。",
            residents: residentText,
          }),
        },
      ],
      maxTokens: 8000,
      effort: "low",
      cacheKey: `elmsford.summary.${village.id}`,
    },
    "village_summary",
    SummarySchema,
  );
  const x = r.data;

  const ids = residents.map((c) => c.id);
  const known = (id: string) => new Map(getKnownFacts(db, village.id, id).map((f) => [f.id, f.text]));
  const delta = socialDelta(facts, known, x, ids);
  for (const p of x.public) if (p.trim()) delta.events.push({ type: "public", text: p.trim(), visibleTo: ["public"] });
  for (const f of x.forPlayer) {
    const c = residents.find((y) => y.id === f.characterId);
    if (!c) continue;
    if (f.item) delta.transfers.push({ from: c.id, to: "loc:player_house", item: f.item, quantity: f.qty && f.qty > 0 ? f.qty : 1 });
    delta.events.push({
      type: "visit",
      text: `${c.shortName}来找过你${f.message ? `，留话说：“${f.message}”` : "。"}${f.item ? `门口留下了${f.item}。` : ""}`,
      visibleTo: [PLAYER_ID],
      locationId: "player_house",
    });
  }

  const utterances: Record<string, string> = {};
  for (const c of residents) utterances[c.id] = ownNews(c, [...x.days.filter((d) => d.characterId === c.id).map((d) => d.text), ...x.public].join("\n"));
  validateAndApply(db, delta, {
    villageId: village.id,
    now: mid,
    source: `${days > 1 ? "week" : "day"}:${date}`,
    participants: ids,
    utterances,
    limits: days > 1 ? WEEK_LIMITS : DAY_LIMITS,
  });

  for (const d of x.days) {
    if (ids.includes(d.characterId) && d.text.trim()) logEvent(db, village.id, mid, "day", { characterId: d.characterId, text: d.text.trim() }, [d.characterId]);
  }
  for (const m of x.moods) {
    const c = residents.find((y) => y.id === m.characterId);
    if (!c || !m.mood.trim()) continue;
    const fresh = getCharacters(db, village.id).find((y) => y.id === c.id)!;
    db.update(t.characters)
      .set({ state: { ...fresh.state, mood: m.mood.trim().slice(0, 12) } })
      .where(and(eq(t.characters.villageId, village.id), eq(t.characters.id, c.id)))
      .run();
  }
  for (const d of dates) {
    db.update(t.villageDays)
      .set({ mode: days > 1 ? "week" : "day" })
      .where(and(eq(t.villageDays.villageId, village.id), eq(t.villageDays.date, d)))
      .run();
  }
}
