import { Fragment, useEffect, useState, type ReactNode } from "react";
import { api, type VillageMap } from "../api";

/** Land characters, so each can take a colour. */
function kind(ch: string): string {
  if (ch === "~" || ch === "=") return "water";
  if (ch === "^") return "wood";
  if (ch === ",") return "field";
  if (ch === "+" || ch === "#") return "mark";
  if (ch === " ") return "";
  return "path";
}

const cell = (ch: string, key: string, cls = kind(ch)) => (
  <span key={key} className={`c ${cls}`}>
    {ch === " " ? " " : ch}
  </span>
);

/** The village drawn in characters, one cell each. Where you are is marked; next door is a step away. */
export function MapView({ here, near, onGo }: { here: string; near: string[]; onGo: (id: string) => void }) {
  const [map, setMap] = useState<VillageMap | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api.map().then(
        (m) => {
          setMap(m);
          // A new village's own map may still be on its way.
          if (!m.final) timer = setTimeout(load, 20_000);
        },
        () => {},
      );
    void load();
    return () => clearTimeout(timer);
  }, []);

  if (!map) return null;
  const starts = new Map(map.labels.map((l) => [`${l.row}:${l.col}`, l]));

  return (
    <div className="map" aria-hidden="true">
      {map.rows.map((row, r) => {
        const cells = Array.from(row);
        const out: ReactNode[] = [];
        for (let c = 0; c < cells.length; c++) {
          const label = starts.get(`${r}:${c}`);
          if (!label) {
            out.push(cell(cells[c]!, `${c}`));
            continue;
          }
          const text = cells.slice(c, c + label.length);
          const glyphs = text.map((ch, j) => cell(ch, `${j}`, "lbl"));
          out.push(
            label.id === here ? (
              <span key={c} className="place here">
                {glyphs}
              </span>
            ) : near.includes(label.id) ? (
              <button key={c} className="place near" tabIndex={-1} onClick={() => onGo(label.id)}>
                {glyphs}
              </button>
            ) : (
              <span key={c} className="place">
                {glyphs}
              </span>
            ),
          );
          c += label.length - 1;
        }
        return (
          <div key={r} className="r">
            <Fragment>{out}</Fragment>
          </div>
        );
      })}
    </div>
  );
}
