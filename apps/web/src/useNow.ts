import { useEffect, useState } from "react";
import { api, type NowResponse } from "./api";

/** Polls the server's notion of "now"; the server tells us how often. */
export function useNow(ready: boolean): { now: NowResponse | null; error: string | null; refresh: () => void } {
  const [now, setNow] = useState<NowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await api.now();
        if (cancelled) return;
        setNow(r);
        setError(null);
        timer = setTimeout(load, r.pollMs);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, tick]);

  return { now, error, refresh: () => setTick((t) => t + 1) };
}
