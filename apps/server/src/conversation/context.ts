// Context assembly for talking to a resident (技术设计 §4.6), most stable first so the prefix caches:
//   1. world + style (fixed)   2. the resident's seed (fixed per resident)
//   3–5. relationship, memories (with an occasional old echo), current state, known facts
//   6. the conversation so far

import { calendar, folk, loadPrompt, renderPrompt } from "@elmsford/content";
import { computeGameTime, describeTime, PLAYER_ID, recallMemories, relativeTimePhrase } from "@elmsford/core";
import type { Db } from "../db/client";
import type { TranscriptLine } from "../db/schema";
import type { SystemBlock } from "../llm/types";
import type { Village } from "../village";
import { KIND_NAMES, listDocuments } from "../scribe/letters";
import { customsForResident } from "../sim/customs";
import { personaNotes } from "../sim/brief";
import { isBusy, presenceOf } from "../world/presence";
import {
  describeInventory,
  formatPence,
  getCharacters,
  getCommitments,
  getInventory,
  getKnownFacts,
  getMemories,
  getRelationship,
  locationName,
  type CharacterRow,
  type MemoryRow,
} from "../world/repo";

export const MEMORY_LIMIT = 8;
export const FACT_LIMIT = 12;
/** Those who left or died are still talked of for a while. */
const STILL_TALKED_OF_MS = 30 * 86_400_000;

export interface Dossier {
  /** Fixed per resident: world, style, seed. Cached. */
  stable: SystemBlock[];
  /** Changes per conversation: state, memories, facts. */
  situation: string;
  recalled: MemoryRow[];
}

function seedPrompt(c: CharacterRow): string {
  return renderPrompt("dialogue", {
    name: c.name,
    age: String(c.age),
    occupation: c.seed.occupation,
    personality: c.seed.personality,
    cares: c.seed.cares,
    flaws: c.seed.flaws,
    wants: c.seed.wants,
    household: c.seed.household ?? "",
    speech: c.seed.speech,
  });
}

export function stableSystem(c: CharacterRow): SystemBlock[] {
  return [{ text: loadPrompt("world") }, { text: seedPrompt(c), cache: true }];
}

/** The village as this resident knows it: the others and how they see them, and the rest of the folk. */
function peopleText(db: Db, village: Village, c: CharacterRow, now: number): string {
  const everyone = getCharacters(db, village.id);
  const lines = everyone
    .filter((o) => o.id !== c.id && o.status === "here")
    .map((o) => {
      const r = getRelationship(db, village.id, c.id, o.id);
      return `- ${o.shortName}（${o.seed.occupation}）${r?.summary ? `：${r.summary}` : ""}`;
    });
  const ids = new Set(everyone.map((o) => o.id));
  const rest = folk.filter((f) => !ids.has(f.id)).map((f) => `${f.shortName}（${f.occupation}）`);
  if (rest.length) lines.push(`- 村里还有：${rest.join("、")}`);
  const gone = everyone.filter((o) => o.status !== "here" && o.endedAt && now - o.endedAt < STILL_TALKED_OF_MS);
  if (gone.length) lines.push(`- 不在村里了：${gone.map((o) => `${o.shortName}${o.status === "dead" ? "（去世了）" : "（走了）"}`).join("、")}`);
  return lines.join("\n");
}

function trustWords(trust: number, affection: number): string {
  const t = trust >= 50 ? "很信得过" : trust >= 20 ? "还算信得过" : trust > -10 ? "还说不上信不信" : trust > -40 ? "不太信得过" : "一点也信不过";
  const a = affection >= 50 ? "打心眼里喜欢" : affection >= 20 ? "挺喜欢" : affection > -10 ? "谈不上喜不喜欢" : affection > -40 ? "有点烦" : "讨厌";
  return `${t}，${a}`;
}

export function buildDossier(db: Db, village: Village, c: CharacterRow, now: number, transcript: TranscriptLine[], opening: string): Dossier {
  const tz = village.timeZone;
  const gt = computeGameTime(now, tz, calendar);
  const time = describeTime(gt, calendar);
  const presence = presenceOf(db, village.id, c, gt);
  const when = (at: number) => relativeTimePhrase(at, now, tz, calendar);

  const rel = getRelationship(db, village.id, c.id, PLAYER_ID);
  const relationship = rel ? `${rel.summary}（${trustWords(rel.trust, rel.affection)}）` : "还是个生人。";

  const query = [opening, ...transcript.slice(-6).map((l) => l.text)].join(" ");
  const all = getMemories(db, village.id, c.id);
  const recall = recallMemories(all, {
    now,
    query,
    focusIds: [PLAYER_ID],
    limit: MEMORY_LIMIT,
    echoChance: 0.35,
  });
  const memories = recall.items.length
    ? recall.items.map((m) => `- ${when(m.at)}：${m.text}`).join("\n")
    : "- 关于这个抄写员，你还没什么印象。";
  const echo = recall.echo ? `\n\n有一件旧事这会儿忽然浮上你心头，合适的话可以提一提：${when(recall.echo.at)}，${recall.echo.text}` : "";

  const facts = getKnownFacts(db, village.id, c.id).slice(0, FACT_LIMIT);
  const factText = facts.length
    ? facts.map((f) => `- ${f.text}${f.belief < 0.6 ? "（你半信半疑）" : ""}${f.source === PLAYER_ID ? "（抄写员说的）" : ""}`).join("\n")
    : "- 没什么特别的。";

  const open = getCommitments(db, village.id, { between: [c.id, PLAYER_ID], status: "open" });
  const commitments = open.length
    ? open.map((x) => `- ${x.byId === PLAYER_ID ? "抄写员答应你" : "你答应抄写员"}：${x.text}（${when(x.createdAt)}说的${x.due ? `，说好${when(x.due)}之前` : ""}）`).join("\n")
    : "- 没有。";

  // Papers they commissioned: they know what they asked for and whether it went off — not what a reply says.
  const papers = listDocuments(db, village.id)
    .filter((d) => d.commissionedBy === c.id && !d.replyToId)
    .map((d) => {
      const what = `${KIND_NAMES[d.kind]}${d.recipient ? `（给${d.recipient}）` : ""}`;
      const state = d.sentAt ? `${when(d.sentAt)}已经交给商贩捎走了` : d.sealedAt ? (d.kind === "letter" ? "已经写好封上，等周四商贩来捎" : "已经写好交到你手上了") : d.dictated ? "你已经口述过了，抄写员还在写" : "托付了，还没口述";
      return `- 你托抄写员写的${what}：${state}`;
    });

  const nextText = presence.next ? `。等会儿（${presence.next.from}）你要去${locationName(presence.next.locationId)}：${presence.next.activity}` : "";
  const inv = getInventory(db, village.id, c.id);

  const situation = renderPrompt("dialogue-context", {
    time: `${time.headline}${time.weekday}，${time.period}，大约 ${time.clock}。${time.fasting}`,
    place: `你在${locationName(presence.block.locationId)}。`,
    activity: presence.block.activity,
    next: nextText,
    concerns: c.state.concerns.length ? c.state.concerns.join("；") : "没什么",
    mood: c.state.mood,
    inventory: describeInventory(inv),
    money: formatPence(c.state.money),
    changes: (() => {
      const notes = personaNotes(db, village.id, c.id);
      return notes.length ? `## 这些日子你的变化\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\n` : "";
    })(),
    relationship,
    people: peopleText(db, village, c, now),
    days: customsForResident(gt, c.id),
    memories,
    echo,
    facts: factText,
    commitments: [commitments, ...papers].join("\n"),
    opening,
  });

  return { stable: stableSystem(c), situation, recalled: recall.echo ? [...recall.items, recall.echo] : recall.items };
}

/** Whether a resident can be talked to right now, and if not, what the player sees instead. */
export function availability(db: Db, village: Village, c: CharacterRow, now: number, playerLocationId: string): { ok: true } | { ok: false; reason: string } {
  const gt = computeGameTime(now, village.timeZone, calendar);
  const p = presenceOf(db, village.id, c, gt);
  if (p.block.locationId !== playerLocationId) return { ok: false, reason: `${c.shortName}不在这儿。` };
  if (p.asleep) return { ok: false, reason: `${c.shortName}睡着了。` };
  if (isBusy(c, now)) return { ok: false, reason: `${c.shortName}刚走开，手上有事。` };
  return { ok: true };
}
