// Shared bits for the dev pages under settings: loading, folding, and writing things down the
// way the village would (dates without years, pence as shillings).

import { chineseDate, zonedParts } from "@elmsford/core";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";

export function useDev<T>(path: string, everyMs?: number): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const reload = useCallback(() => void api.get<T>(path).then(setData, () => {}), [path]);
  useEffect(() => {
    reload();
    if (!everyMs) return;
    const timer = setInterval(reload, everyMs);
    return () => clearInterval(timer);
  }, [reload, everyMs]);
  return { data, reload };
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="place-name">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A heading that opens and closes what's under it. */
export function Fold({ title, count, open: initial = false, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={`fold ${open ? "open" : ""}`}>
      <button className="fold-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="place-name">{title}</span>
        {count !== undefined && <span className="dim">{count}</span>}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

export const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;

/** "十月二十日 10:05", in the village's time zone. */
export function when(at: number, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${chineseDate(p.month, p.day)} ${p.hour}:${String(p.minute).padStart(2, "0")}`;
}

/** "2026-10-21" → "十月二十一日" */
export const dateText = (date: string) => chineseDate(Number(date.slice(5, 7)), Number(date.slice(8, 10)));

export function pence(n: number): string {
  if (n <= 0) return "没钱";
  const s = Math.floor(n / 12);
  const d = n % 12;
  return s ? `${s} 先令${d ? ` ${d} 便士` : ""}` : `${d} 便士`;
}

export function namer(characters: { id: string; shortName: string }[]) {
  const names = new Map(characters.map((c) => [c.id, c.shortName]));
  return (id: string) => (id === "player" ? "你" : (names.get(id) ?? id));
}
