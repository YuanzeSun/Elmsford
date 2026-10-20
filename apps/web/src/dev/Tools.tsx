// The dev tools on the settings page itself: the clock, and letting someone play a few days for you.

import { useEffect, useState } from "react";
import { api, type NowResponse } from "../api";
import { Dots } from "../views/Dots";
import { dateText, Section, usd, useDev } from "./common";

interface SimState {
  status: { running: boolean; behindMs: number; mode: string | null };
  player: {
    running: boolean;
    stage: { kind: "catching_up"; date: string } | { kind: "talking"; date: string; with: string } | { kind: "judging" } | null;
    days: { date: string; talkedTo: string | null; costUsd: number; newMemories: number; happenings: string[]; error?: string }[];
    totalCostUsd: number;
    style: { score: number; verdict: string } | null;
    error: string | null;
  } | null;
}

/** "hours 2026-10-21" → "补到十月二十一日" */
function catchingUp(mode: string | null): string {
  const [kind, date] = (mode ?? "").split(" ");
  if (!date) return "补日子";
  return kind === "week" ? `补${dateText(date)}那一周` : `补到${dateText(date)}`;
}

/** Behind the clock by at least this much counts as catching up. */
const CATCHING_UP_MS = 30 * 60_000;

const SPEEDS: [string, number][] = [
  ["停", 0],
  ["×1", 1],
  ["×60", 60],
  ["×600", 600],
  ["×3600", 3600],
  ["×86400", 86_400],
];

export function Clock({ now, onChange }: { now: NowResponse | null; onChange: () => void }) {
  const { data } = useDev<SimState>("/sim", 2000);
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (!now || local) return;
    const p = (n: number) => String(n).padStart(2, "0");
    setLocal(`${now.gameTime.date}T${p(now.gameTime.hour)}:${p(now.gameTime.minute)}`);
  }, [now, local]);
  if (!now) return null;
  const send = (body: unknown) => void api.post("/clock", body).then(onChange, () => {});
  const { text, clock: c } = now;
  // Only real catching up: the village is behind the clock (after a jump, or a long absence).
  // Its ordinary work — planning a day, the hour just gone — isn't shown. The simulated player
  // drives the clock itself; its own line says what's going on.
  const running = data?.status.running && data.status.behindMs >= CATCHING_UP_MS && !data.player?.running;

  return (
    <Section title="时钟">
      <p className="scene">{text.headline}</p>
      <p className="meta">
        {text.dateText} {text.clock} · {text.weekday} · {text.period} · {now.weather.text}
      </p>
      <p className="meta">{text.bells.map((b) => `${b.name} ${b.clock}`).join("　")}</p>
      {/* A story village keeps its own time: no speeds, only jumping ahead. */}
      {c.mode !== "story" && (
        <div className="row">
          <span className="inline-choices">
            <button className={c.mode === "real" ? "on" : ""} onClick={() => send({ action: "real" })}>
              现实
            </button>
            {SPEEDS.map(([label, speed]) => (
              <button key={label} className={c.mode === "fake" && c.speed === speed ? "on" : ""} onClick={() => send({ action: "speed", speed })}>
                {label}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className="row">
        <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
        <button className="quiet" onClick={() => send({ action: "jump", local })}>
          跳过去
        </button>
      </div>
      {running && (
        <p className="meta">
          {catchingUp(data.status.mode)}
          <Dots />
        </p>
      )}
    </Section>
  );
}

function stageText(stage: NonNullable<NonNullable<SimState["player"]>["stage"]>): string {
  if (stage.kind === "judging") return "看台词";
  if (stage.kind === "talking") return `${dateText(stage.date)} · 跟${stage.with}说话`;
  return `${dateText(stage.date)} · 补日子`;
}

/** 代玩: someone plays the scribe for a few days, to see how the village holds up. */
export function Proxy({ onChange }: { onChange: () => void }) {
  const { data, reload } = useDev<SimState>("/sim", 2000);
  const [days, setDays] = useState(3);
  const [turns, setTurns] = useState(3);
  const p = data?.player;
  const start = () =>
    void api.post("/sim/player", { days, talk: true, turns }).then(
      () => {
        reload();
        onChange();
      },
      () => {},
    );
  // While running, the last day is still under way; it shows as the stage line instead.
  const done = p ? (p.running ? p.days.slice(0, -1) : p.days) : [];

  return (
    <Section title="代玩">
      <div className="row">
        替你过
        <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        天，每天找人说
        <input type="number" min={1} max={8} value={turns} onChange={(e) => setTurns(Number(e.target.value))} />句
        {p?.running ? (
          <button className="quiet" onClick={() => void api.post("/sim/player/stop", {})}>
            停
          </button>
        ) : (
          <button className="quiet" onClick={start}>
            开始
          </button>
        )}
      </div>

      {p && (done.length > 0 || p.running) && (
        <div className="ledger" style={{ marginTop: "0.8rem" }}>
          {done.map((d) => (
            <div key={d.date}>
              <span className="num">{dateText(d.date)}</span>
              <span className="grow">{d.error ? <span className="error">{d.error}</span> : [d.talkedTo ?? "没找到人", ...d.happenings].join(" · ")}</span>
              <span className="num">记下 {d.newMemories}</span>
              <span className="num">{usd(d.costUsd)}</span>
            </div>
          ))}
          {p.running ? (
            <div>
              <span className="grow dim">
                {p.stage ? stageText(p.stage) : ""}
                <Dots />
              </span>
            </div>
          ) : (
            <div>
              <span className="grow">{p.style ? `台词 ${p.style.score} 分 · ${p.style.verdict}` : p.error ? <span className="error">{p.error}</span> : ""}</span>
              <span className="num">{usd(p.totalCostUsd)}</span>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
