// Someone new in the village: a background villager stepping forward, or a stranger arriving.
// The model writes who they are; this decides what of it holds. Nothing here touches the world —
// the server writes the result, together with the routine and home that content fixes.

export interface NewcomerView {
  personId: string;
  trust: number;
  affection: number;
  summary: string;
}

/** What the model proposes. */
export interface NewcomerDraft {
  name: string;
  shortName: string;
  age: number;
  occupation: string;
  personality: string;
  cares: string;
  flaws: string;
  wants: string;
  situation: string;
  speech: string;
  household: string;
  mood: string;
  concerns: string[];
  /** Their own recent past, before the village starts following them. */
  memories: { text: string; importance: number }[];
  /** How they see the residents. */
  views: NewcomerView[];
  /** How residents see them. */
  seenBy: NewcomerView[];
}

export interface NewcomerRules {
  /** Fixed by content for someone the village already knows; overrides the draft. */
  fixed?: { name: string; shortName: string; age: number };
  /** The trade, when content already says what they do. */
  occupation?: string;
  ages: [number, number];
  /** Names and short names already in use. */
  taken: ReadonlySet<string>;
  /** Residents they can have views about, or be seen by. */
  residents: ReadonlySet<string>;
  /** How strong feelings can start: people who grew up here know everyone, strangers nobody. */
  maxFeeling: number;
}

export type Newcomer = Omit<NewcomerDraft, "memories" | "views" | "seenBy"> & {
  memories: { text: string; importance: number }[];
  views: NewcomerView[];
  seenBy: NewcomerView[];
};

const HAN_NAME = /^[一-鿿·]+$/;
const LIMITS = {
  occupation: 30,
  personality: 80,
  cares: 80,
  flaws: 80,
  wants: 80,
  situation: 120,
  speech: 60,
  household: 60,
} as const;

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");
/** Short fields read like labels: no full stop at the end. */
const label = (s: unknown) => clean(s).replace(/[。．.]+$/, "");
const clamp = (n: unknown, lo: number, hi: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : 0);

function views(list: NewcomerView[] | undefined, rules: NewcomerRules): NewcomerView[] {
  const seen = new Set<string>();
  const out: NewcomerView[] = [];
  for (const v of list ?? []) {
    const summary = clean(v.summary);
    if (!rules.residents.has(v.personId) || seen.has(v.personId) || summary.length < 2 || summary.length > 40) continue;
    seen.add(v.personId);
    out.push({ personId: v.personId, trust: clamp(v.trust, -rules.maxFeeling, rules.maxFeeling), affection: clamp(v.affection, -rules.maxFeeling, rules.maxFeeling), summary });
  }
  return out;
}

/**
 * Who they are, if it holds together. Errors are things the model has to write again (a name
 * that's taken, an empty personality); lesser slips (a view of someone who doesn't live here,
 * a fourth concern) are dropped quietly.
 */
export function validateNewcomer(draft: NewcomerDraft, rules: NewcomerRules): { ok: true; newcomer: Newcomer } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = rules.fixed?.name ?? clean(draft.name);
  const shortName = rules.fixed?.shortName ?? clean(draft.shortName);
  const age = rules.fixed?.age ?? clamp(draft.age, 0, 120);

  if (!rules.fixed) {
    if (!HAN_NAME.test(name) || name.length < 2 || name.length > 12) errors.push("name 要写成中文译名，2 到 12 个字，比如“玛蒂尔达·克罗夫特”");
    if (!HAN_NAME.test(shortName) || shortName.length > 5 || !name.includes(shortName)) errors.push("shortName 是 name 里的一部分，平常怎么叫他，最多 5 个字");
    if (rules.taken.has(name) || rules.taken.has(shortName)) errors.push(`村里已经有人叫“${shortName}”了，换一个名字`);
    if (age < rules.ages[0] || age > rules.ages[1]) errors.push(`age 要在 ${rules.ages[0]} 到 ${rules.ages[1]} 之间`);
  }

  const fields = {} as Record<keyof typeof LIMITS, string>;
  for (const [key, max] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
    const value = key === "occupation" ? (rules.occupation ?? label(draft.occupation)) : clean(draft[key]);
    if (value.length < 2) errors.push(`${key} 不能空着`);
    else if (value.length > max) errors.push(`${key} 太长了，最多 ${max} 个字`);
    fields[key] = value;
  }
  if (errors.length) return { ok: false, errors };

  const mood = clean(draft.mood);
  return {
    ok: true,
    newcomer: {
      name,
      shortName,
      age,
      ...fields,
      mood: mood.length >= 1 && mood.length <= 8 ? label(mood) : "照常",
      concerns: (draft.concerns ?? []).map(label).filter((c) => c.length >= 2 && c.length <= 30).slice(0, 3),
      memories: (draft.memories ?? [])
        .map((m) => ({ text: clean(m.text), importance: clamp(m.importance, 1, 7) }))
        .filter((m) => m.text.length >= 4 && m.text.length <= 120)
        .slice(0, 3),
      views: views(draft.views, rules),
      seenBy: views(draft.seenBy, rules),
    },
  };
}
