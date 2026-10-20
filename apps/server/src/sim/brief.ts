// Compact descriptions of residents for the simulation prompts. Facts are given short ids
// (F1, F2, …) so the model can refer to them without inventing ids; the map comes back with them.

import { calendar, locations } from "@elmsford/content";
import { PLAYER_ID, recallMemories, relativeTimePhrase } from "@elmsford/core";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { Village } from "../village";
import {
  describeInventory,
  formatPence,
  getCharacters,
  getCommitments,
  getInventory,
  getKnownFacts,
  getMemories,
  type CharacterRow,
} from "../world/repo";

export class FactIds {
  private readonly toReal = new Map<string, string>();
  private readonly toShort = new Map<string, string>();

  short(realId: string): string {
    let s = this.toShort.get(realId);
    if (!s) {
      s = `F${this.toShort.size + 1}`;
      this.toShort.set(realId, s);
      this.toReal.set(s, realId);
    }
    return s;
  }

  real(shortId: string): string | undefined {
    return this.toReal.get(shortId.trim().toUpperCase());
  }
}

export const placeList = () =>
  locations
    .filter((l) => !l.offstage)
    .map((l) => `- ${l.id}：${l.name}`)
    .join("\n");

function healthWords(h: number): string {
  if (h >= 80) return "身体好";
  if (h >= 60) return "身体还行";
  if (h >= 40) return "不太舒服";
  if (h >= 25) return "病着";
  return "病得起不来";
}

export function personaNotes(db: Db, villageId: string, characterId: string): string[] {
  return db
    .select()
    .from(t.personaNotes)
    .where(and(eq(t.personaNotes.villageId, villageId), eq(t.personaNotes.characterId, characterId)))
    .orderBy(desc(t.personaNotes.at))
    .limit(3)
    .all()
    .map((n) => n.text);
}

export interface BriefOptions {
  now: number;
  facts?: FactIds;
  /** Names of others in the scene; their relationships are included. */
  others?: string[];
  memoryLimit?: number;
  factLimit?: number;
  /** Query text for memory relevance. */
  query?: string;
}

export function residentBrief(db: Db, village: Village, c: CharacterRow, o: BriefOptions): string {
  const when = (at: number) => relativeTimePhrase(at, o.now, village.timeZone, calendar);
  const all = getCharacters(db, village.id);
  const nameOf = (id: string) => (id === PLAYER_ID ? "抄写员" : all.find((x) => x.id === id)?.shortName ?? id);

  const lines = [
    `### ${c.name}（id：${c.id}，${c.age} 岁，${c.seed.occupation}）`,
    `性格：${c.seed.personality} 在乎：${c.seed.cares} 毛病：${c.seed.flaws}`,
  ];
  const notes = personaNotes(db, village.id, c.id);
  if (notes.length) lines.push(`这些日子的变化：${notes.join("；")}`);
  lines.push(
    `眼下：${healthWords(c.state.health)}，心情${c.state.mood}，身上${formatPence(c.state.money)}，手上有${describeInventory(getInventory(db, village.id, c.id))}。`,
    `心里挂着：${c.state.concerns.length ? c.state.concerns.join("；") : "没什么"}`,
  );

  const others = o.others ?? all.filter((x) => x.id !== c.id && x.status === "here").map((x) => x.id);
  const rels = db
    .select()
    .from(t.relationships)
    .where(and(eq(t.relationships.villageId, village.id), eq(t.relationships.fromId, c.id)))
    .all()
    .filter((r) => others.includes(r.toId));
  if (rels.length) lines.push(`对别人的看法：${rels.map((r) => `${nameOf(r.toId)}——${r.summary}`).join("；")}`);

  const open = getCommitments(db, village.id, { status: "open" }).filter((x) => x.byId === c.id || x.toId === c.id);
  if (open.length) {
    lines.push(
      `约定：${open.map((x) => (x.byId === c.id ? `答应${nameOf(x.toId)}${x.text}` : `${nameOf(x.byId)}答应他${x.text}`) + (x.due ? `（${when(x.due)}之前）` : "")).join("；")}`,
    );
  }

  const recall = recallMemories(getMemories(db, village.id, c.id), {
    now: o.now,
    query: o.query ?? c.state.concerns.join(" "),
    focusIds: others,
    limit: o.memoryLimit ?? 4,
    echoChance: 0,
  });
  if (recall.items.length) lines.push(`记得的事：${recall.items.map((m) => `${when(m.at)}，${m.text}`).join("；")}`);

  if (o.facts) {
    const facts = getKnownFacts(db, village.id, c.id).slice(0, o.factLimit ?? 6);
    if (facts.length) lines.push(`他知道的事：${facts.map((f) => `[${o.facts!.short(f.id)}] ${f.text}`).join("；")}`);
  }
  return lines.join("\n");
}
