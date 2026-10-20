// The village map: a grid of characters drawn by the model once per new village. The drawing is
// the model's; what it must contain is checked here — every place exactly once, no stray words,
// nothing but plain ASCII for the land. Each character (a Han character too) is one cell.

export interface MapLabel {
  id: string;
  row: number;
  col: number;
  length: number;
}

export interface VillageMap {
  rows: string[];
  labels: MapLabel[];
}

export interface MapRules {
  maxWidth: number;
  maxHeight: number;
  minHeight: number;
  required: { id: string; short: string }[];
  optional?: { id: string; short: string }[];
  /** Other words the map may carry, e.g. a river's name. */
  extraWords?: string[];
  /** Where on the map a place belongs: rows as a fraction from the top (0) to the bottom (1). */
  regions?: { id: string; from: number; to: number; where: string }[];
  /** Places that sit next to each other: rows apart + columns apart / 2 ≤ within. */
  near?: { a: string; b: string; within: number }[];
  /** Relative bearings that must hold, e.g. the manor north of the green. */
  bearings?: { a: string; dir: "north" | "south" | "east" | "west"; b: string }[];
  /**
   * The river: places stay on its north bank, out of the water — except crossings, which sit on
   * it. Banks are places that must be right at the water's edge (within so many rows).
   */
  river?: { chars: string; crossings: string[]; banks: { id: string; within: number }[] };
}

export type MapCheck = { ok: true; map: VillageMap } | { ok: false; errors: string[] };

const HAN = /\p{Script=Han}/u;

function findAll(cells: string[], word: string[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i + word.length <= cells.length; i++) {
    if (word.every((ch, j) => cells[i + j] === ch)) hits.push(i);
  }
  return hits;
}

export function checkMap(raw: readonly string[], rules: MapRules): MapCheck {
  const errors: string[] = [];
  let rows = raw.map((r) => r.replace(/\t/g, " ").replace(/　/g, " ").replace(/\s+$/u, ""));
  while (rows.length && !rows[0]) rows.shift();
  while (rows.length && !rows[rows.length - 1]) rows.pop();

  if (rows.length < rules.minHeight || rows.length > rules.maxHeight) errors.push(`行数 ${rows.length}，应在 ${rules.minHeight} 到 ${rules.maxHeight} 之间`);
  const grid = rows.map((r) => Array.from(r));
  const width = Math.max(0, ...grid.map((r) => r.length));
  if (width > rules.maxWidth) errors.push(`最宽一行有 ${width} 格，超过 ${rules.maxWidth}`);

  const covered = grid.map((r) => r.map(() => false));
  const labels: MapLabel[] = [];
  const place = (id: string, short: string, required: boolean) => {
    const word = Array.from(short);
    const hits = grid.flatMap((cells, row) => findAll(cells, word).map((col) => ({ row, col })));
    if (required && hits.length === 0) errors.push(`缺了“${short}”`);
    if (hits.length > 1) {
      errors.push(`“${short}”写了 ${hits.length} 次`);
      // Already reported; don't count these characters as stray words too.
      for (const h of hits) word.forEach((_, j) => (covered[h.row]![h.col + j] = true));
    }
    if (hits.length !== 1) return;
    const { row, col } = hits[0]!;
    for (let j = 0; j < word.length; j++) {
      if (covered[row]![col + j]) errors.push(`“${short}”和别的字叠在一起`);
      covered[row]![col + j] = true;
    }
    labels.push({ id, row, col, length: word.length });
  };
  for (const p of rules.required) place(p.id, p.short, true);
  for (const p of rules.optional ?? []) place(p.id, p.short, false);
  for (const w of rules.extraWords ?? []) {
    const word = Array.from(w);
    grid.forEach((cells, row) => findAll(cells, word).forEach((col) => word.forEach((_, j) => (covered[row]![col + j] = true))));
  }

  const stray = new Set<string>();
  const odd = new Set<string>();
  grid.forEach((cells, row) =>
    cells.forEach((ch, col) => {
      if (HAN.test(ch)) {
        if (!covered[row]![col]) stray.add(ch);
      } else {
        const code = ch.codePointAt(0)!;
        if (code < 0x20 || code > 0x7e) odd.add(ch);
      }
    }),
  );
  if (stray.size) errors.push(`多了地名以外的字：${[...stray].join("")}`);
  if (odd.size) errors.push(`用了不许用的符号：${[...odd].join(" ")}`);

  // Geography, once every place has been found.
  if (!errors.length) {
    const at = new Map(labels.map((l) => [l.id, { row: l.row, col: l.col + (l.length - 1) / 2 }]));
    const name = (id: string) => [...rules.required, ...(rules.optional ?? [])].find((p) => p.id === id)?.short ?? id;
    for (const n of rules.near ?? []) {
      const pa = at.get(n.a);
      const pb = at.get(n.b);
      if (pa && pb && Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col) / 2 > n.within) errors.push(`“${name(n.a)}”应该挨着“${name(n.b)}”`);
    }
    const DIR = { north: "北", south: "南", east: "东", west: "西" } as const;
    for (const d of rules.bearings ?? []) {
      const pa = at.get(d.a);
      const pb = at.get(d.b);
      if (!pa || !pb) continue;
      const ok = d.dir === "north" ? pa.row < pb.row : d.dir === "south" ? pa.row > pb.row : d.dir === "east" ? pa.col > pb.col : pa.col < pb.col;
      if (!ok) errors.push(`“${name(d.a)}”应该在“${name(d.b)}”的${DIR[d.dir]}边`);
    }
    for (const r of rules.regions ?? []) {
      const p = at.get(r.id);
      if (!p || rows.length < 2) continue;
      const y = p.row / (rows.length - 1);
      if (y < r.from || y > r.to) errors.push(`“${name(r.id)}”应该在${r.where}`);
    }
  }

  if (!errors.length && rules.river) {
    const { chars, crossings, banks } = rules.river;
    const isWater = (ch: string | undefined) => ch !== undefined && ch !== "" && chars.includes(ch);
    const wet = (r: number, c: number) => isWater(grid[r]?.[c]);
    const name = (id: string) => rules.required.find((p) => p.id === id)?.short ?? id;
    for (const l of labels) {
      const cols = Array.from({ length: l.length }, (_, j) => l.col + j);
      const beside = wet(l.row, l.col - 1) || wet(l.row, l.col + l.length);
      const touching = beside || cols.some((c) => wet(l.row - 1, c) || wet(l.row + 1, c));
      if (crossings.includes(l.id)) {
        if (!touching) errors.push(`“${name(l.id)}”应该画在河上`);
        continue;
      }
      if (beside) errors.push(`“${name(l.id)}”画进河里了，应该在河的北岸`);
      else if (cols.some((c) => grid.slice(0, l.row).some((cells) => isWater(cells[c])))) errors.push(`“${name(l.id)}”画到河南边去了`);
    }
    for (const b of banks) {
      const l = labels.find((x) => x.id === b.id);
      if (!l) continue;
      const cols = Array.from({ length: l.length }, (_, j) => l.col + j);
      const close = cols.some((c) => Array.from({ length: b.within }, (_, k) => l.row + 1 + k).some((r) => wet(r, c)));
      if (!close) errors.push(`“${name(b.id)}”应该紧挨着河的北岸`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, map: { rows: grid.map((r) => [...r, ...Array(width - r.length).fill(" ")].join("")), labels } };
}
