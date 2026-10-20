// 日志: what happened, in order — model calls, days, events, conversations, refused changes.

import { useState } from "react";
import { api } from "../api";
import { Dots } from "../views/Dots";
import { dateText, Fold, namer, usd, useDev, when } from "./common";
import { KIND, type World } from "./VillagePage";

interface CallRow {
  id: string;
  startedAt: number;
  purpose: string;
  model: string | null;
  status: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
}

interface CallDetail {
  tierRequested: string;
  tierUsed: string;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  error: string | null;
  request: { system: { text: string; cache?: boolean }[]; messages: { role: string; content: string }[]; json?: { name: string }; tools?: string[] };
  response: string | null;
  toolCalls: { name: string; input: unknown }[] | null;
}

interface PulseDay {
  date: string;
  weather: string;
  happenings: string[];
  memories: number;
  flag: "stagnant" | "soap" | null;
}

const PURPOSES: Record<string, string> = {
  dialogue: "对话",
  extraction: "提取",
  "sim.plan_day": "规划",
  "sim.encounters": "来往",
  "sim.day_summary": "日总结",
  "sim.week_summary": "周总结",
  "sim.recap": "这几天",
  "sim.reflection": "反思",
  "sim.newcomer": "新来的人",
  "scribe.dictation": "口述",
  "scribe.remote_person": "收信人",
  "scribe.remote_reply": "回信",
  "world.map": "地图",
  "dev.style_judge": "看台词",
  "dev.sim_player": "代玩",
};

function purposeText(p: string): string {
  if (PURPOSES[p]) return PURPOSES[p];
  const cut = p.lastIndexOf(".");
  const head = PURPOSES[p.slice(0, cut)];
  return head ? `${head} · ${p.slice(cut + 1)}` : p;
}

const clock = (at: number) => new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

function Call({ row }: { row: CallRow }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [opened, setOpened] = useState(false);
  const toggle = (open: boolean) => {
    setOpened(open);
    if (open && !detail) void api.get<CallDetail>(`/llm/calls/${row.id}`).then(setDetail, () => {});
  };
  return (
    <details className="item" onToggle={(e) => toggle((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="num">{clock(row.startedAt)}</span>
        <span className="who">{purposeText(row.purpose)}</span>
        {row.status !== "ok" && <span className="error">{row.status}</span>}
        <span className="dim grow-right">
          {row.inputTokens + row.cacheReadTokens}/{row.outputTokens} · {usd(row.costUsd)} · {(row.durationMs / 1000).toFixed(0)}s
        </span>
      </summary>
      {opened && (
        <div className="item-body">
          {!detail ? (
            <Dots />
          ) : (
            <>
              <p className="dim">
                {detail.tierUsed === detail.tierRequested ? detail.tierUsed : `${detail.tierRequested}→${detail.tierUsed}`} · {detail.model ?? "—"}
                {detail.stopReason ? ` · ${detail.stopReason}` : ""}
                {row.cacheReadTokens ? ` · 缓存 ${row.cacheReadTokens}` : ""}
              </p>
              {detail.error && <pre className="data error">{detail.error}</pre>}
              {detail.request.system.map((b, i) => (
                <details key={i}>
                  <summary className="dim">
                    系统 {i + 1} · {b.text.length} 字{b.cache ? " · 缓存" : ""}
                  </summary>
                  <pre className="data">{b.text}</pre>
                </details>
              ))}
              {detail.request.messages.map((m, i) => (
                <div key={i}>
                  <h4>{m.role === "user" ? "发" : "答"}</h4>
                  <pre className="data">{m.content}</pre>
                </div>
              ))}
              {detail.response !== null && (
                <>
                  <h4>回</h4>
                  <pre className="data">{detail.response || "（空）"}</pre>
                </>
              )}
              {!!detail.toolCalls?.length && (
                <>
                  <h4>动作</h4>
                  <pre className="data">{detail.toolCalls.map((t) => `${t.name} ${JSON.stringify(t.input)}`).join("\n")}</pre>
                </>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}

const EVENT: Record<string, string> = {
  encounter: "来往",
  overheard: "旁听",
  conversation: "说话",
  transfer: "东西",
  commission: "托付",
  document_sealed: "封信",
  letter_sent: "寄信",
  letter_arrived: "回信",
  day: "一天",
  public: "村里",
  happening: "出事",
  visit: "来访",
  death: "去世",
  arrival: "来人",
  departure: "走了",
};

type Payload = Record<string, unknown> & { text?: string };

function eventText(type: string, raw: unknown, name: (id: string) => string, place: (id: string) => string): string {
  const p = (raw ?? {}) as Payload;
  const s = (k: string) => String(p[k] ?? "");
  switch (type) {
    case "encounter":
      return `${place(s("locationId"))}：${s("summary")}`;
    case "overheard":
      return `${place(s("locationId"))}：${((p.lines as { name: string; text: string }[]) ?? []).map((l) => `${l.name}：${l.text}`).join(" ")}`;
    case "conversation":
      return `你和${name(s("characterId"))}说话${p.endedBy === "character" ? "，对方走开了" : ""}`;
    case "transfer": {
      const to = s("to");
      const what = p.pence ? `${s("pence")} 便士` : `${s("item")}${Number(p.quantity) > 1 ? `×${s("quantity")}` : ""}`;
      return `${name(s("from"))}给了${to.startsWith("loc:") ? place(to.slice(4)) : name(to)}${what}`;
    }
    case "commission":
      return `${name(s("by"))}托你写${KIND[s("kind")] ?? s("kind")}${p.recipient ? `，给${s("recipient")}` : ""}`;
    case "document_sealed":
      return `${name(s("by"))}的${KIND[s("kind")] ?? ""}封好了，付了 ${s("paid")} 便士`;
    case "letter_sent":
      return `${name(s("by"))}的信让商贩捎走了`;
    case "letter_arrived":
      return `${s("from")}的回信到了`;
    case "day":
      return `${name(s("characterId"))}：${s("text")}`;
    default:
      return p.text ?? "";
  }
}

/** What the change would have done, had it not been stopped. */
const ALMOST: Record<string, string> = {
  memories: "差点记住",
  facts: "差点信了",
  commitments: "差点答应",
  relationships: "差点改了看法",
  concerns: "差点添了心事",
  transfers: "差点给出",
  playerNotes: "差点记进你的笔记本",
  lore: "差点记进日子",
  events: "差点发生",
};

const REASONS: [RegExp, string][] = [
  [/^not grounded/, "对方没这么说过"],
  [/^too many/, "一次太多"],
  [/must be part|wasn't part|both sides|only a participating|only someone present|who was there/, "不在场的人"],
  [/teller doesn't know/, "说的人自己不知道"],
  [/already known/, "早就知道"],
  [/may change by at most/, "变得太猛"],
  [/doesn't have it|not enough money|nothing to transfer/, "没有这东西"],
  [/unknown/, "没有这回事"],
  [/text length|summary length|bad /, "写得不像样"],
  [/no such concern/, "没这件心事"],
  [/due date/, "日子不对"],
  [/duplicate/, "重复"],
];
const reasonText = (r: string) => REASONS.find(([re]) => re.test(r))?.[1] ?? r;
function itemText(item: unknown, name: (id: string) => string): string {
  if (typeof item === "string") return item;
  const o = (item ?? {}) as Payload;
  if (o.text) return String(o.text);
  if ("trustDelta" in o) return `${name(String(o.from))}对${name(String(o.to))}，信 ${Number(o.trustDelta) >= 0 ? "+" : ""}${String(o.trustDelta)}，好 ${Number(o.affectionDelta) >= 0 ? "+" : ""}${String(o.affectionDelta)}`;
  if ("from" in o && "to" in o) return `${name(String(o.from))}给${name(String(o.to))}${o.pence ? `${String(o.pence)} 便士` : String(o.item ?? "")}`;
  return String(o.summary ?? o.item ?? JSON.stringify(item));
}

export function LogsPage() {
  const calls = useDev<CallRow[]>("/llm/calls?limit=60", 10_000).data;
  const pulse = useDev<PulseDay[]>("/pulse", 30_000).data;
  const w = useDev<World>("/world", 15_000).data;
  if (!calls || !w)
    return (
      <p className="dim">
        <Dots />
      </p>
    );
  const tz = w.village?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = namer(w.characters);
  const place = (id: string) => w.locations.find((l) => l.id === id)?.name ?? id;
  const today = new Date().setHours(0, 0, 0, 0);
  const spent = calls.filter((r) => r.startedAt >= today).reduce((sum, r) => sum + r.costUsd, 0);

  return (
    <>
      <Fold title="调用" count={calls.length} open>
        <p className="meta">今天花了 {usd(spent)}</p>
        {calls.map((r) => (
          <Call key={r.id} row={r} />
        ))}
      </Fold>

      <Fold title="天气和大事" count={pulse?.length ?? 0}>
        <div className="ledger">
          {(pulse ?? []).map((d) => (
            <div key={d.date} className={d.flag ? "flagged" : ""}>
              <span className="num">{dateText(d.date)}</span>
              <span className="grow">{[d.weather, ...d.happenings].join(" · ")}</span>
              <span className="num">
                记下 {d.memories}
                {d.flag === "stagnant" ? " · 太静" : d.flag === "soap" ? " · 太闹" : ""}
              </span>
            </div>
          ))}
        </div>
      </Fold>

      <Fold title="事件" count={w.events.length}>
        <div className="ledger">
          {w.events.map((e) => (
            <div key={e.id}>
              <span className="num">{when(e.at, tz)}</span>
              <span className="num">{EVENT[e.type] ?? e.type}</span>
              <span className="grow">{eventText(e.type, e.payload, name, place)}</span>
            </div>
          ))}
        </div>
      </Fold>

      <Fold title="对话" count={w.conversations.length}>
        {w.conversations.map((c) => (
          <details key={c.id} className="item">
            <summary>
              <span className="who">{name(c.characterId)}</span>
              <span className="dim">
                {when(c.startedAt, tz)} · {place(c.locationId)} · {c.transcript.length} 句{c.endedAt ? "" : " · 还在说"}
              </span>
            </summary>
            <div className="item-body">
              {c.transcript.map((l, i) =>
                l.speaker === "scene" || l.speaker === "narration" ? (
                  <p key={i} className="dim">
                    {l.text}
                  </p>
                ) : (
                  <p key={i}>
                    <span className="speaker">{name(l.speaker)}</span>
                    {l.text}
                  </p>
                ),
              )}
            </div>
          </details>
        ))}
      </Fold>

      <Fold title="不作数的" count={w.rejections.length}>
        <div className="ledger">
          {w.rejections.map((r) => (
            <div key={r.id}>
              <span className="num">{when(r.at, tz)}</span>
              <span className="grow">
                {ALMOST[r.field] ?? r.field}：{itemText(r.item, name)}
                <span className="dim">（{reasonText(r.reason)}）</span>
              </span>
            </div>
          ))}
        </div>
      </Fold>
    </>
  );
}
