import { useState } from "react";
import type { NowResponse } from "../api";

/**
 * The day's headline. A name in it the player has been told about (a feast, a bell) is quietly
 * marked; touching it brings back what they heard. Names they haven't asked about stay plain.
 */
export function Headline({ text, heard }: { text: string; heard: NowResponse["heard"] }) {
  const [open, setOpen] = useState<string | null>(null);

  const parts: (string | { match: string })[] = [];
  let rest = text;
  for (const h of heard) {
    const i = rest.indexOf(h.match);
    if (i < 0) continue;
    parts.push(rest.slice(0, i), { match: h.match });
    rest = rest.slice(i + h.match.length);
  }
  parts.push(rest);
  const shown = heard.find((h) => h.match === open);

  return (
    <>
      <p className="headline">
        {parts.map((p, i) =>
          typeof p === "string" ? (
            <span key={i}>{p}</span>
          ) : (
            <button key={i} className={`heard ${open === p.match ? "on" : ""}`} onClick={() => setOpen(open === p.match ? null : p.match)}>
              {p.match}
            </button>
          ),
        )}
      </p>
      {shown && (
        <div className="heard-lines">
          {shown.lines.map((l, i) => (
            <p key={i}>{l.text}</p>
          ))}
        </div>
      )}
    </>
  );
}
