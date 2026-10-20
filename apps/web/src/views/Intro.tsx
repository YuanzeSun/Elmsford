import { VILLAGE } from "@elmsford/content/names";
import { useState } from "react";
import type { TimeMode } from "../api";

/** The first time into a new village: who you are and where, how the days go, then in you go. */
export function Intro({
  paragraphs,
  hint,
  modes,
  onDone,
}: {
  paragraphs: string[];
  hint: string;
  modes: { id: TimeMode; name: string; text: string }[];
  onDone: (mode: TimeMode) => void;
}) {
  const [mode, setMode] = useState<TimeMode>(modes[0]!.id);
  const [going, setGoing] = useState(false);
  return (
    <div className="recap intro" role="dialog" aria-label={VILLAGE}>
      <div className="recap-inner">
        <h2>{VILLAGE}</h2>
        {paragraphs.map((p, i) => (
          <p key={i} className="scene">
            {p}
          </p>
        ))}
        <div className="modes">
          <span className="inline-choices">
            {modes.map((m) => (
              <button key={m.id} className={m.id === mode ? "on" : ""} onClick={() => setMode(m.id)}>
                {m.name}
              </button>
            ))}
          </span>
          <p className="scene">{modes.find((m) => m.id === mode)?.text}</p>
        </div>
        <p className="meta hint">{hint}</p>
        <button
          disabled={going}
          onClick={() => {
            setGoing(true);
            onDone(mode);
          }}
        >
          进村
        </button>
      </div>
    </div>
  );
}
