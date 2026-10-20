import { VILLAGE } from "@elmsford/content/names";
import { useCallback, useEffect, useState } from "react";
import type { NowResponse } from "./api";
import { ambience, sceneFor } from "./ambience";
import { notifyState, pollNotifications, setNotify } from "./notify";
import { Headline } from "./views/Headline";
import { Desk, Notebook } from "./views/House";
import { Place } from "./views/Place";
import { Recap } from "./views/Recap";

type Tab = "village" | "desk" | "notebook";

export function Village({ now, onMoved }: { now: NowResponse; onMoved: () => void }) {
  const { gameTime: gt, text } = now;
  const [tab, setTab] = useState<Tab>("village");
  const [showRecap, setShowRecap] = useState(true);
  const [seenRecap, setSeenRecap] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [notify, setNotifyState] = useState(notifyState);
  const [atHome, setAtHome] = useState(false);
  const [locationId, setLocationId] = useState("player_house");
  const [sound, setSound] = useState(() => localStorage.getItem("elmsford.sound") === "on");
  // The bell that last rang when the page opened; only bells after it are heard.
  const [lastBell, setLastBell] = useState(() => `${gt.date}:${gt.bells.last.id}`);


  // Sound is opt-in (browsers need a click anyway) and remembered.
  useEffect(() => {
    if (!sound) return ambience.stop();
    ambience.start();
    localStorage.setItem("elmsford.sound", "on");
  }, [sound]);
  useEffect(() => {
    ambience.set(sceneFor(now.weather, locationId, gt));
  }, [now.weather, locationId, gt.light, gt.period, gt.month, gt.liturgical.holyDay]);
  useEffect(() => {
    const { last } = gt.bells;
    const key = `${gt.date}:${last.id}`;
    // In story mode time moves in steps (a walk is ten minutes), so a bell rung during the last
    // step is still heard. A rest that skips hours doesn't ring everything it skipped.
    const fresh = last.minutesAgo < (now.story ? 15 : 2);
    if (key !== lastBell) {
      setLastBell(key);
      if (fresh && (last.id !== "curfew" || locationId !== "player_house")) ambience.bell(last.id === "noon" ? 1 : 3);
    }
  }, [gt.bells, gt.date, lastBell, locationId, now.story]);

  useEffect(
    () =>
      pollNotifications((t) => {
        const id = Date.now() + Math.random();
        setToasts((ts) => [...ts, { id, text: t }]);
        setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 12_000);
      }),
    [],
  );

  const refreshHome = useCallback(() => {
    void fetch("/api/place")
      .then((r) => r.json())
      .then((p: { location?: { id: string } }) => {
        setAtHome(p.location?.id === "player_house");
        if (p.location) setLocationId(p.location.id);
      });
  }, []);
  useEffect(refreshHome, [refreshHome, tab]);

  // A new "这几天" can appear mid-session (laptop woke up, dev clock jumped).
  useEffect(() => {
    if (now.recapId && now.recapId !== seenRecap) setShowRecap(true);
  }, [now.recapId, seenRecap]);
  const doneRecap = useCallback(() => {
    setShowRecap(false);
    setSeenRecap(now.recapId);
  }, [now.recapId]);

  return (
    <main className="page village">
      {showRecap && <Recap onDone={doneRecap} />}

      <header className="top">
        <span className="village-name">{VILLAGE}</span>
        <nav className="tabs">
          <button className={tab === "village" ? "on" : ""} onClick={() => setTab("village")}>
            村子
          </button>
          <button className={tab === "desk" ? "on" : ""} onClick={() => setTab("desk")}>
            书桌
          </button>
          <button className={tab === "notebook" ? "on" : ""} onClick={() => setTab("notebook")}>
            笔记本
          </button>
        </nav>
      </header>

      <Headline text={text.headline} heard={now.heard} />
      <p className="meta">
        {text.weekday} · {text.period} · {now.weather.text}
      </p>
      {text.fasting && <p className="meta">{text.fasting}</p>}

      <div className="body">
        {tab === "village" && (
          <Place
            story={now.story}
            onMoved={() => {
              onMoved();
              refreshHome();
            }}
          />
        )}
        {tab === "desk" && <Desk atHome={atHome} />}
        {tab === "notebook" && <Notebook />}
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} className="toast">
            {t.text}
          </p>
        ))}
      </div>

      <footer className="village-footer">
        <span>
          {text.dateText} {text.clock} · 日出 {text.sunrise} · 日落 {text.sunset}
          {now.clock.mode === "fake" && <span className="fake-clock">　×{now.clock.speed}</span>}
        </span>
        <span className="footer-links">
          <button
            className="link"
            onClick={() => {
              if (sound) localStorage.setItem("elmsford.sound", "off");
              setSound(!sound);
            }}
          >
            {sound ? "静音" : "声音"}
          </button>
          {(notify === "on" || notify === "off") && (
            <button className="link" onClick={() => void setNotify(notify === "off").then(setNotifyState)}>
              {notify === "on" ? "关通知" : "通知"}
            </button>
          )}
          <a href="/settings">设置</a>
        </span>
      </footer>
    </main>
  );
}
