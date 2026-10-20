import { useEffect, useState } from "react";
import { api, type Recap as RecapRow } from "../api";
import { Dots } from "./Dots";

/** "这几天": shown once on coming back, while the village finishes catching up behind it. */
export function Recap({ onDone }: { onDone: () => void }) {
  const [recap, setRecap] = useState<RecapRow | null | undefined>(undefined);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api.recap().then(
        (r) => {
          setRecap(r.recap);
          if (r.recap?.status === "pending") timer = setTimeout(load, 3000);
          if (!r.recap) onDone();
        },
        () => onDone(),
      );
    void load();
    return () => clearTimeout(timer);
  }, [onDone]);

  if (!recap) return null;
  const close = () => {
    void api.seenRecap(recap.id);
    onDone();
  };

  return (
    <div className="recap" role="dialog" aria-label="这几天">
      <div className="recap-inner">
        <h2>这几天</h2>
        {recap.status === "pending" ? (
          <>
            <p className="scene dim">
              <Dots />
            </p>
            <button className="quiet" onClick={close}>
              进村
            </button>
          </>
        ) : (
          <>
            {recap.text.split(/\n+/).map((p, i) => (
              <p key={i} className="scene">
                {p}
              </p>
            ))}
            <button onClick={close}>进村</button>
          </>
        )}
      </div>
    </div>
  );
}
