import { VILLAGE } from "@elmsford/content/names";
import { useCallback, useEffect, useState } from "react";
import { ambience, savedVolume, VOLUMES, type Volume } from "../ambience";
import { api, type NowResponse } from "../api";
import { LogsPage } from "../dev/LogsPage";
import { Clock, Proxy } from "../dev/Tools";
import { VillagePage } from "../dev/VillagePage";
import { Link, usePath } from "../router";
import { Dots } from "./Dots";

type Route = { tier: string; provider: string; model: string } | { tier: string; error: string };
interface LlmStatus {
  selection: Record<string, string>;
  efforts: Record<string, string>;
  routes: Route[];
}
type ModelList = { ok: true; models: string[] } | { ok: false } | null;
type Catalog = { anthropic: ModelList; openai: ModelList; chatgpt: ModelList; deepseek: ModelList };

interface Accounts {
  chatgpt: { signedIn: boolean; canUsePlan: boolean; name: string | null; email: string | null };
  deepseek: { connected: boolean };
}

const TIERS: [string, string][] = [
  ["dialogue", "对话"],
  ["planner", "规划"],
  ["cheap", "幕后"],
];
const EFFORTS: [string, string][] = [
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["xhigh", "很高"],
];
const effortName = (e: string | undefined) => EFFORTS.find(([k]) => k === e)?.[1];

const GROUPS: [keyof Catalog, string][] = [
  ["anthropic", "Claude"],
  ["openai", "OpenAI"],
  ["chatgpt", "ChatGPT"],
  ["deepseek", "DeepSeek"],
];

function ModelRow({
  label,
  route,
  selected,
  effort,
  catalog,
  onPick,
  onEffort,
}: {
  label: string;
  route: Route;
  selected: string | undefined;
  effort: string | undefined;
  catalog: Catalog | null;
  onPick: (spec: string | null) => void;
  onEffort: (effort: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (spec: string | null) => {
    onPick(spec);
    setOpen(false);
  };
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <button className="value" onClick={() => setOpen(!open)}>
          {"error" in route ? <span className="dim">—</span> : route.model}
          {effortName(effort) && <span className="dim">　思考{effortName(effort)}</span>}
        </button>
        {open && !catalog && (
          <div className="choices">
            <Dots />
          </div>
        )}
        {open && catalog && (
          <div className="choices">
            <div className="group">思考</div>
            <div className="options">
              <button className={effort ? "" : "on"} onClick={() => onEffort(null)}>
                默认
              </button>
              {EFFORTS.map(([key, name]) => (
                <button key={key} className={effort === key ? "on" : ""} onClick={() => onEffort(key)}>
                  {name}
                </button>
              ))}
            </div>
            <div className="group">模型</div>
            <div className="options">
              <button className={selected ? "" : "on"} onClick={() => pick(null)}>
                默认
              </button>
            </div>
            {GROUPS.map(([provider, name]) => {
              const list = catalog?.[provider];
              if (!list?.ok || !list.models.length) return null;
              return (
                <div key={provider}>
                  <div className="group">{name}</div>
                  <div className="options">
                    {list.models.map((m) => {
                      const spec = `${provider}:${m}`;
                      return (
                        <button key={m} className={selected === spec ? "on" : ""} onClick={() => pick(spec)}>
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </dd>
    </div>
  );
}

function Models({ version }: { version: number }) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const load = useCallback(() => void api.settings<LlmStatus>("/llm").then(setStatus, () => {}), []);
  useEffect(() => {
    load();
    void api.settings<Catalog>(`/llm/models${version ? "?refresh=1" : ""}`).then(setCatalog, () => {});
  }, [load, version]);

  if (!status)
    return (
      <section className="section">
        <h2 className="place-name">模型</h2>
        <Dots />
      </section>
    );
  const nothing = status.routes.every((r) => "error" in r) && !GROUPS.some(([p]) => catalog?.[p]?.ok);
  return (
    <section className="section">
      <h2 className="place-name">模型</h2>
      {nothing ? (
        <p className="dim">没找到可用的模型。</p>
      ) : (
        <dl className="rows">
          {TIERS.map(([tier, label]) => {
            const route = status.routes.find((r) => r.tier === tier) ?? { tier, error: "" };
            return (
              <ModelRow
                key={tier}
                label={label}
                route={route}
                selected={status.selection[tier]}
                effort={status.efforts[tier]}
                catalog={catalog}
                onPick={(spec) => void api.saveSetting<LlmStatus>("/llm/selection", { tier, spec }).then(setStatus, () => {})}
                onEffort={(effort) => void api.saveSetting<LlmStatus>("/llm/effort", { tier, effort }).then(setStatus, () => {})}
              />
            );
          })}
        </dl>
      )}
    </section>
  );
}

const SIGN_IN: Record<string, string> = {
  noplan: "登上了，但这个账号没让用它的 ChatGPT 套餐。",
  denied: "没登上。",
  error: "没登上。",
};

/** Accounts connected here rather than read from a CLI: a ChatGPT sign-in, a DeepSeek key. */
function AccountsSection({ onChange }: { onChange: () => void }) {
  const [a, setA] = useState<Accounts | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(() => {
    const outcome = new URLSearchParams(location.search).get("chatgpt");
    return outcome ? (SIGN_IN[outcome] ?? null) : null;
  });

  useEffect(() => {
    void api.settings<Accounts>("/accounts").then(setA, () => {});
    // Drop ?chatgpt=… from the address once read.
    if (location.search) history.replaceState(null, "", location.pathname);
  }, []);

  const update = (next: Accounts) => {
    setA(next);
    onChange();
  };

  const signIn = async () => {
    setBusy(true);
    try {
      const { url } = await api.saveSetting<{ url: string }>("/chatgpt/start", { returnTo: location.href.split("?")[0] });
      location.assign(url);
    } catch {
      setNote("没登上。");
      setBusy(false);
    }
  };

  const saveKey = async () => {
    setBusy(true);
    try {
      update(await api.saveSetting<Accounts>("/deepseek", { key }));
      setKey("");
      setKeyOpen(false);
      setNote(null);
    } catch {
      setNote("这个 key 接不上。");
    }
    setBusy(false);
  };

  if (!a) return null;
  const who = a.chatgpt.name ?? a.chatgpt.email;

  return (
    <section className="section">
      <h2 className="place-name">账号</h2>
      <dl className="rows">
        <div>
          <dt>ChatGPT</dt>
          <dd>
            {a.chatgpt.signedIn ? (
              <>
                {who ?? "已登录"}
                {!a.chatgpt.canUsePlan && <span className="dim">　不能用套餐</span>}
                <button className="quiet" onClick={() => void api.saveSetting<Accounts>("/chatgpt/signout", {}).then(update, () => {})}>
                  退出
                </button>
              </>
            ) : (
              <button className="quiet" onClick={() => void signIn()} disabled={busy}>
                用 ChatGPT 登录
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>DeepSeek</dt>
          <dd>
            {a.deepseek.connected ? (
              <>
                已接上
                <button className="quiet" onClick={() => void api.forget<Accounts>("/deepseek").then(update, () => {})}>
                  去掉
                </button>
              </>
            ) : keyOpen ? (
              <span className="key-row">
                <input
                  type="password"
                  value={key}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-…"
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey()}
                />
                <button className="quiet" onClick={() => void saveKey()} disabled={busy || !key.trim()}>
                  {busy ? <Dots /> : "接上"}
                </button>
                <button className="quiet" onClick={() => setKeyOpen(false)}>
                  算了
                </button>
              </span>
            ) : (
              <button className="quiet" onClick={() => setKeyOpen(true)}>
                填 API key
              </button>
            )}
          </dd>
        </div>
      </dl>
      {note && <p className="note">{note}</p>}
    </section>
  );
}

/** Leaving: this village ends; you move into a new one, map and all. */
/** How loud the village is, when its sound is on. */
function Sound() {
  const [volume, setVolume] = useState<Volume>(savedVolume);
  return (
    <section className="section">
      <h2 className="place-name">声音</h2>
      <span className="inline-choices">
        {VOLUMES.map(([v, name]) => (
          <button
            key={v}
            className={v === volume ? "on" : ""}
            onClick={() => {
              setVolume(v);
              ambience.setVolume(v);
            }}
          >
            {name}
          </button>
        ))}
      </span>
    </section>
  );
}

function Leave() {
  const [asking, setAsking] = useState(false);
  const go = () => void api.leave().then(() => location.assign("/"), () => setAsking(false));
  return (
    <section className="section leave">
      {asking ? (
        <p>
          离开了，就回不来了。
          <button className="quiet" onClick={go}>
            走
          </button>
          <button className="quiet" onClick={() => setAsking(false)}>
            留下
          </button>
        </p>
      ) : (
        <button className="quiet" onClick={() => setAsking(true)}>
          离开 {VILLAGE}
        </button>
      )}
    </section>
  );
}

/** The two second-level pages, dev mode only: they show what the game keeps hidden. */
const PAGES: { path: string; title: string; hint: string }[] = [
  { path: "/settings/village", title: "村里", hint: "人、还没露面的、约定、文书、收信人" },
  { path: "/settings/logs", title: "日志", hint: "调用、天气和大事、事件、对话、不作数的" },
];

export function Settings({ now, devMode, refreshNow }: { now: NowResponse | null; devMode: boolean; refreshNow: () => void }) {
  const path = usePath();
  const [accountsVersion, setAccountsVersion] = useState(0);
  const page = devMode ? PAGES.find((p) => path.startsWith(p.path)) : undefined;

  return (
    <main className={`page ${devMode ? "wide" : ""}`}>
      <header className="top">
        <span className="village-name">{page ? page.title : VILLAGE}</span>
        {page ? <Link to="/settings">回设置</Link> : <a href="/">回村子</a>}
      </header>

      {page?.path === "/settings/village" && <VillagePage today={now?.gameTime.date} />}
      {page?.path === "/settings/logs" && <LogsPage />}

      {!page && (
        <>
          <Models version={accountsVersion} />
          <AccountsSection onChange={() => setAccountsVersion((v) => v + 1)} />
          <Sound />
          {devMode && (
            <>
              <Clock now={now} onChange={refreshNow} />
              <Proxy onChange={refreshNow} />
              <nav className="section menu">
                {PAGES.map((p) => (
                  <Link key={p.path} to={p.path}>
                    <span>{p.title}</span>
                    <span className="dim">{p.hint}</span>
                    <span className="dim">›</span>
                  </Link>
                ))}
              </nav>
            </>
          )}
          <Leave />
        </>
      )}
    </main>
  );
}
