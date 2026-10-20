// The friction table and the director (技术设计 §4.5). The director only ever adds a
// *happening* to the world — weather turns, someone falls ill, something breaks, a peddler comes.
// What anyone does about it is theirs to decide, in planning and conversation.

import { pickWeighted, seededRng } from "./random";

export interface FrictionEffect {
  /** Change to the target's health. */
  health?: number;
  /** Something that now weighs on the target. */
  concern?: string;
  money?: number;
  /** Something that appears (or is lost, with negative qty). */
  item?: { name: string; qty: number; owner: "target" | `loc:${string}` };
  /** Makes today's weather this, overriding the roll. */
  weather?: { sky: "rain" | "storm" | "fog" | "snow" | "clear"; text: string };
}

export interface FrictionDef {
  id: string;
  /** "{name}" is replaced by the person it falls on. */
  text: string;
  weight: number;
  /** Who it can fall on; omitted for village-wide happenings. */
  target?: "anyone" | "elderly" | "young" | string[];
  months?: number[];
  /** Only in cold (≤ °C). */
  maxTempC?: number;
  /** Not again within this many days. */
  cooldownDays: number;
  /** Who gets to know: just the target, or everyone. */
  visibility: "target" | "public";
  effect: FrictionEffect;
}

/** Someone in the village now. */
export interface DirectorPerson {
  id: string;
  name: string;
  age: number;
  health: number;
}

export interface DirectorInput {
  seed: string;
  month: number;
  tempC: number;
  /** 0 = lots happening, 1 = nothing at all. */
  calm: number;
  people: DirectorPerson[];
  /** Happenings already used, with how many days ago. */
  recent: { id: string; daysAgo: number }[];
  table: FrictionDef[];
}

export interface Happening {
  defId: string;
  text: string;
  characterId?: string;
  visibility: FrictionDef["visibility"];
  effect: FrictionEffect;
}

/** Above this, the village is too quiet and the director may step in. */
export const CALM_THRESHOLD = 0.6;

/**
 * Calm from the last few days: how many notable things happened (important memories, concern
 * changes, conflicts). Few → close to 1.
 */
export function calmScore(notable: number, days: number, residents: number): number {
  const perPersonPerDay = notable / Math.max(1, days * residents);
  return Math.max(0, Math.min(1, 1 - perPersonPerDay / 0.8));
}

function eligible(def: FrictionDef, person: DirectorPerson): boolean {
  if (!def.target || def.target === "anyone") return true;
  if (def.target === "elderly") return person.age >= 55;
  if (def.target === "young") return person.age < 30;
  return def.target.includes(person.id);
}

export function direct(input: DirectorInput): Happening | null {
  const rng = seededRng(input.seed);
  if (input.calm < CALM_THRESHOLD || rng() > input.calm) return null;

  const onCooldown = new Set(input.recent.filter((r) => r.daysAgo < (input.table.find((d) => d.id === r.id)?.cooldownDays ?? 0)).map((r) => r.id));
  const plausible = input.table.filter(
    (d) =>
      !onCooldown.has(d.id) &&
      (!d.months || d.months.includes(input.month)) &&
      (d.maxTempC === undefined || input.tempC <= d.maxTempC) &&
      (!d.target || input.people.some((p) => eligible(d, p))),
  );
  const def = pickWeighted(plausible, (d) => d.weight, rng);
  if (!def) return null;

  let person: DirectorPerson | undefined;
  if (def.target) {
    // Frailer people catch more of what's going around.
    person = pickWeighted(input.people.filter((p) => eligible(def, p)), (p) => 1 + (100 - p.health) / 50 + (p.age >= 60 ? 1 : 0), rng);
    if (!person) return null;
  }
  return {
    defId: def.id,
    text: def.text.replaceAll("{name}", person?.name ?? ""),
    ...(person ? { characterId: person.id } : {}),
    visibility: def.visibility,
    effect: def.effect,
  };
}
