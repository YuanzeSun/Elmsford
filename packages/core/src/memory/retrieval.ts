// Memory retrieval (技术设计 §4.6, §4.9): recency + importance + relevance, plus a chance of
// an older memory surfacing on its own — the "echo" that lets old small things come back.
// Relevance is character-bigram overlap for now (Chinese has no spaces); vectors can come later.

export interface RecallableMemory {
  id: string;
  at: number;
  text: string;
  importance: number;
  participants: string[];
  kind?: string;
  /** Faded by weekly reflection; 1 = fresh. */
  weight?: number;
}

export interface RecallOptions {
  now: number;
  /** Text the memories should be relevant to (the conversation so far, a plan's concerns…). */
  query: string;
  /** People in the current situation; memories involving them score higher. */
  focusIds: string[];
  limit: number;
  /** Probability of adding one older memory as an echo. */
  echoChance?: number;
  /** Memories at least this old may echo. */
  echoMinAgeMs?: number;
  /** Ids already in context, never returned again. */
  exclude?: ReadonlySet<string>;
  /** 0 ≤ rng() < 1; injectable so tests are deterministic. */
  rng?: () => number;
}

export interface Recall<M extends RecallableMemory> {
  items: M[];
  echo?: M;
}

const HOUR = 3_600_000;
const RECENCY_HALF_LIFE_HOURS = 72;

export function bigrams(text: string): Set<string> {
  const clean = text.replace(/[\s，。、！？；：“”‘’「」（）()…—\-,.!?;:"']/g, "");
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  return out;
}

export function relevance(query: Set<string>, text: Set<string>): number {
  if (query.size === 0 || text.size === 0) return 0;
  let shared = 0;
  for (const g of text) if (query.has(g)) shared++;
  return shared / Math.sqrt(query.size * text.size);
}

export function recallMemories<M extends RecallableMemory>(memories: M[], opts: RecallOptions): Recall<M> {
  const rng = opts.rng ?? Math.random;
  const exclude = opts.exclude ?? new Set<string>();
  const query = bigrams(opts.query);
  const focus = new Set(opts.focusIds);

  const scored = memories
    .filter((m) => !exclude.has(m.id))
    .map((m) => {
      const ageHours = Math.max(0, (opts.now - m.at) / HOUR);
      const recency = Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
      const importance = (m.importance / 10) * (m.weight ?? 1);
      const rel = relevance(query, bigrams(m.text));
      const involves = m.participants.some((p) => focus.has(p)) ? 0.5 : 0;
      const reflection = m.kind === "reflection" ? 0.3 : 0;
      return { m, score: recency + importance + 2 * rel + involves + reflection };
    })
    .sort((a, b) => b.score - a.score);

  const items = scored.slice(0, opts.limit).map((s) => s.m);
  const chosen = new Set(items.map((m) => m.id));

  let echo: M | undefined;
  const minAge = opts.echoMinAgeMs ?? 7 * 24 * HOUR;
  if (rng() < (opts.echoChance ?? 0.3)) {
    const pool = scored.map((s) => s.m).filter((m) => !chosen.has(m.id) && opts.now - m.at >= minAge && m.importance >= 4);
    const total = pool.reduce((sum, m) => sum + m.importance, 0);
    let pick = rng() * total;
    for (const m of pool) {
      pick -= m.importance;
      if (pick < 0) {
        echo = m;
        break;
      }
    }
  }

  return echo ? { items, echo } : { items };
}
