// The location view (技术设计 §5): who is here, what they're doing, where you can go.
// Scene text is assembled from templates and state; no LLM needed to look around.

import { calendar, folk, locations } from "@elmsford/content";
import { computeGameTime, PLAYER_ID, seededRng, signsHere, type GameTime, type Location } from "@elmsford/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { Village } from "../village";
import { inEffect } from "../sim/customs";
import { isBusy, presenceOf, type Presence } from "./presence";
import { getCharacters, getResidents, getInventory, describeInventory } from "./repo";

export interface PersonHere {
  id: string;
  name: string;
  activity: string;
  canTalk: boolean;
  note?: string;
  /** They came here meaning to see the player. */
  lookingForYou: boolean;
}

export interface PlaceView {
  location: { id: string; name: string; description: string };
  scene: string;
  people: PersonHere[];
  exits: { id: string; name: string; note?: string }[];
  /** Things left here, e.g. on your doorstep. */
  itemsHere: string | null;
}

const byId = new Map(locations.map((l) => [l.id, l]));

const LIGHT_LINES: Record<string, Record<string, string>> = {
  deep_night: { default: "四下里黑透了，只有河水的声音。" },
  dawn: { default: "天刚亮，地上还有一层薄霜似的白气。" },
  morning: { default: "上午的光照在泥路上。" },
  noon: { default: "正午，太阳不高，影子短短的。" },
  afternoon: { default: "下午，风从河那边吹过来。" },
  evening: { default: "天色暗下来了，有人家的烟囱冒着烟。" },
  night: { default: "天黑了，窗缝里漏出一点火光。" },
};

/**
 * Now and then, one of the villagers who isn't a resident (yet) going about their day here.
 * Ordinary days only; on holy days they're at mass and at home like everyone else.
 */
function folkLine(villageId: string, residentIds: ReadonlySet<string>, loc: Location, gt: GameTime): string {
  if (gt.liturgical.holyDay) return "";
  const lines = folk.filter((f) => !residentIds.has(f.id)).flatMap((f) => f.seen.filter((s) => s.locationId === loc.id && s.periods.includes(gt.period)));
  const rng = seededRng(`${villageId}:${gt.date}:${gt.hour}:${loc.id}:folk`);
  return lines.length && rng() < 0.6 ? lines[Math.floor(rng() * lines.length)]!.text : "";
}

function sceneLine(loc: Location, gt: GameTime, people: Presence[], folkSeen: string): string {
  const light = LIGHT_LINES[gt.period]?.default ?? "";
  // What the days look like here: seen, not explained.
  const signs = signsHere(inEffect(gt), loc.id, gt.period).join("");
  const crowd = people.length === 0 && !folkSeen ? "这儿一个人也没有。" : "";
  const holy = gt.liturgical.holyDay && (gt.period === "morning" || gt.period === "noon") ? "今天不干重活，人们穿得比平常齐整。" : "";
  return [light, loc.description, signs, folkSeen, holy, crowd].filter(Boolean).join("");
}

export function placeView(db: Db, village: Village, now: number): PlaceView {
  const gt = computeGameTime(now, village.timeZone, calendar);
  const here = village.playerLocationId;
  const loc = byId.get(here) ?? byId.get("player_house")!;

  const presences = getResidents(db, village.id).map((c) => presenceOf(db, village.id, c, gt));
  const herePeople = presences.filter((p) => p.block.locationId === here);

  const people: PersonHere[] = herePeople.map((p) => {
    const busy = isBusy(p.character, now);
    const lookingForYou = Boolean(p.block.intent && p.block.withIds?.includes(PLAYER_ID) && !p.asleep && !busy);
    return {
      id: p.character.id,
      name: p.character.shortName,
      activity: p.asleep ? "睡着了" : lookingForYou && here === "player_house" ? "在你门口，像是有事找你" : p.block.activity,
      canTalk: !p.asleep && !busy,
      lookingForYou,
      ...(busy ? { note: "刚走开，手上有事" } : lookingForYou && here !== "player_house" ? { note: "看见你，像是有话要说" } : {}),
    };
  });

  const exits = loc.neighbors
    .map((id) => byId.get(id))
    .filter((l): l is Location => Boolean(l && !l.offstage))
    .map((l) => {
      const owners = presences.filter((p) => p.character.seed.homeId === l.id);
      if (!l.house || !owners.length) return { id: l.id, name: l.name };
      const home = owners.filter((p) => p.block.locationId === l.id);
      const note = home.length === 0 ? "门关着" : home.every((p) => p.asleep) ? "屋里黑着" : undefined;
      return { id: l.id, name: l.name, ...(note ? { note } : {}) };
    });

  const left = getInventory(db, village.id, `loc:${here}`);

  return {
    location: { id: loc.id, name: loc.name, description: loc.description },
    scene: sceneLine(loc, gt, herePeople, folkLine(village.id, new Set(getCharacters(db, village.id).map((c) => c.id)), loc, gt)),
    people,
    exits,
    itemsHere: left.size ? describeInventory(left) : null,
  };
}

export type MoveResult = { ok: true } | { ok: false; reason: string };

export function movePlayer(db: Db, village: Village, to: string, now: number): MoveResult {
  const from = byId.get(village.playerLocationId);
  const dest = byId.get(to);
  if (!dest || dest.offstage) return { ok: false, reason: "去不了那儿。" };
  if (!from?.neighbors.includes(to)) return { ok: false, reason: "从这儿走不过去。" };

  const owners = dest.house ? getResidents(db, village.id).filter((c) => c.seed.homeId === to) : [];
  if (owners.length) {
    const gt = computeGameTime(now, village.timeZone, calendar);
    const home = owners.map((c) => presenceOf(db, village.id, c, gt)).filter((p) => p.block.locationId === to);
    if (!home.length) return { ok: false, reason: "你敲了敲门，没人应。" };
    if (home.every((p) => p.asleep)) return { ok: false, reason: "屋里黑着灯，人都睡了。你没敲门。" };
  }

  db.update(t.villages).set({ playerLocationId: to }).where(eq(t.villages.id, village.id)).run();
  return { ok: true };
}

/** Pick up whatever was left where the player stands. */
export function pickUp(db: Db, village: Village): string | null {
  const owner = `loc:${village.playerLocationId}`;
  const items = getInventory(db, village.id, owner);
  if (!items.size) return null;
  db.transaction((tx) => {
    tx.delete(t.inventory).where(and(eq(t.inventory.villageId, village.id), eq(t.inventory.ownerId, owner))).run();
    for (const [item, quantity] of items) {
      const mine = getInventory(tx as unknown as Db, village.id, PLAYER_ID).get(item) ?? 0;
      tx.insert(t.inventory)
        .values({ villageId: village.id, ownerId: PLAYER_ID, item, quantity: mine + quantity })
        .onConflictDoUpdate({ target: [t.inventory.villageId, t.inventory.ownerId, t.inventory.item], set: { quantity: mine + quantity } })
        .run();
    }
  });
  return describeInventory(items);
}
