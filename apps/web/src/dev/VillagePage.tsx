// 村里: everything true about the village right now, one person (or thing) at a time.

import type { PlanBlock } from "@elmsford/core";
import { api } from "../api";
import { Dots } from "../views/Dots";
import { dateText, Fold, namer, pence, useDev, when } from "./common";

interface Character {
  id: string;
  name: string;
  shortName: string;
  age: number;
  status: "here" | "gone" | "dead";
  joinedAt: number | null;
  leavesOn: string | null;
  endedAt: number | null;
  seed: { occupation: string };
  state: { health: number; mood: string; money: number; locationId: string; activity: string; concerns: string[] };
}

export interface World {
  village: { timeZone: string; playerLocationId: string; playerMoney: number } | null;
  characters: Character[];
  relationships: { fromId: string; toId: string; trust: number; affection: number; summary: string }[];
  facts: { id: string; text: string; at: number }[];
  factKnowledge: { factId: string; characterId: string; belief: number; source: string }[];
  memories: { id: string; characterId: string; at: number; text: string; importance: number; kind: string }[];
  commitments: { id: string; byId: string; toId: string; text: string; due: number | null; status: string; createdAt: number }[];
  dayPlans: { characterId: string; date: string; blocks: PlanBlock[] }[];
  documents: { id: string; kind: string; commissionedBy: string; recipient: string | null; status: string; gist: string; dictated: string; written: string; sealedAt: number | null; replyToId: string | null; readAt: number | null; createdAt: number }[];
  inventory: { ownerId: string; item: string; quantity: number }[];
  remotePeople: { id: string; name: string; relation: string; place: string; alive: boolean; description: string; linkedCharacterId: string }[];
  personaNotes: { characterId: string; at: number; text: string; reason: string }[];
  locations: { id: string; name: string }[];
  events: { id: string; at: number; type: string; payload: unknown; visibleTo: string[] }[];
  conversations: { id: string; characterId: string; locationId: string; startedAt: number; endedAt: number | null; endedBy: string | null; transcript: { speaker: string; text: string; at: number }[] }[];
  rejections: { id: string; at: number; source: string; field: string; item: unknown; reason: string }[];
  folk: { id: string; shortName: string; occupation: string; mentions: number }[];
  openings: { id: string; occupation: string; inSeason: boolean }[];
  newcomers: { id: string; kind: "folk" | "arrival"; sourceId: string; characterId: string; at: number; status: "pending" | "done" | "dropped" }[];
}

export const KIND: Record<string, string> = { letter: "信", contract: "契约", will: "遗嘱", record: "记录" };
const STATUS: Record<string, string> = { open: "还没做", kept: "做到了", broken: "没做到", released: "作罢了" };
const DOC_STATUS: Record<string, string> = { draft: "还在桌上", sent: "捎走了", delivered: "到了", replied: "有回信了" };

const goods = (items: World["inventory"], owner: string) =>
  items
    .filter((i) => i.ownerId === owner && i.quantity > 0)
    .map((i) => (i.quantity > 1 ? `${i.item}×${i.quantity}` : i.item))
    .join("、") || "什么也没有";

function Person({ c, w, today }: { c: Character; w: World; today: string }) {
  const tz = w.village!.timeZone;
  const name = namer(w.characters);
  const place = (id: string) => w.locations.find((l) => l.id === id)?.name ?? id;
  const views = w.relationships.filter((r) => r.fromId === c.id);
  const plan = w.dayPlans.find((p) => p.characterId === c.id && p.date === today)?.blocks.filter((b) => !b.asleep) ?? [];
  const memories = w.memories.filter((m) => m.characterId === c.id).slice(0, 12);
  const known = w.factKnowledge.filter((k) => k.characterId === c.id);
  const changes = w.personaNotes.filter((n) => n.characterId === c.id);
  const source = (s: string) => (s === "player" ? "听你说的" : s === "seen" ? "亲眼见的" : `听${name(s)}说的`);

  return (
    <details className="item">
      <summary>
        <span className="who">{c.shortName}</span>
        <span className="dim">{c.status === "here" ? `${place(c.state.locationId)} · ${c.state.activity} · ${c.state.mood}` : c.status === "dead" ? "不在了" : "走了"}</span>
      </summary>
      <div className="item-body">
        <p>
          {c.age} 岁，{c.seed.occupation}。身体 {c.state.health} · {pence(c.state.money)}
        </p>
        {(c.joinedAt || c.leavesOn || c.endedAt) && (
          <p className="dim">
            {[c.joinedAt && `${when(c.joinedAt, tz)}来的`, c.leavesOn && c.status === "here" && `${dateText(c.leavesOn)}走`, c.endedAt && `${when(c.endedAt, tz)}${c.status === "dead" ? "去世" : "走的"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <p>心里挂着：{c.state.concerns.join("；") || "没什么"}</p>
        <p>手上：{goods(w.inventory, c.id)}</p>
        {changes.map((n, i) => (
          <p key={i}>
            变了：{n.text}<span className="dim">（{n.reason}）</span>
          </p>
        ))}

        <h4>怎么看别人</h4>
        <ul>
          {views.map((r) => (
            <li key={r.toId}>
              {name(r.toId)}
              <span className="dim">
                　信 {r.trust} · 好 {r.affection}
              </span>
              {r.summary}
            </li>
          ))}
        </ul>

        {plan.length > 0 && (
          <>
            <h4>今天</h4>
            <ul>
              {plan.map((b, i) => (
                <li key={i}>
                  <span className="dim">
                    {b.from}–{b.to}{" "}
                  </span>
                  {place(b.locationId)} · {b.activity}
                  {b.intent && (
                    <span className="dim">
                      　想找{(b.withIds ?? []).map(name).join("、")}：{b.intent}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <h4>记得</h4>
        {memories.length ? (
          <ul>
            {memories.map((m) => (
              <li key={m.id}>
                <span className="dim">{when(m.at, tz)} · {m.kind === "reflection" ? "想法" : m.importance}　</span>
                {m.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dim">还没有。</p>
        )}

        <h4>知道</h4>
        {known.length ? (
          <ul>
            {known.map((k) => (
              <li key={k.factId}>
                {w.facts.find((f) => f.id === k.factId)?.text}
                <span className="dim">
                  （{source(k.source)}，信 {Math.round(k.belief * 100)}%）
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dim">没什么。</p>
        )}
      </div>
    </details>
  );
}

/** Villagers who haven't stepped forward, and the kinds of people who might come. */
function NotYet({ w, reload }: { w: World; reload: () => void }) {
  const ids = new Set(w.characters.map((c) => c.id));
  const pending = w.newcomers.find((n) => n.status === "pending");
  const call = (kind: "folk" | "arrival", id: string) => void api.post("/newcomer", { kind, id }).then(reload, () => {});
  const button = (kind: "folk" | "arrival", id: string) =>
    pending ? null : (
      <button className="quiet" onClick={() => call(kind, id)}>
        叫来
      </button>
    );
  const folk = w.folk.filter((f) => !ids.has(f.id));
  return (
    <Fold title="还没露面的" count={folk.length + w.openings.length}>
      {pending && (
        <p className="dim">
          {w.folk.find((f) => f.id === pending.sourceId)?.shortName ?? w.openings.find((o) => o.id === pending.sourceId)?.occupation}要来了
          <Dots />
        </p>
      )}
      <ul className="plain">
        {folk.map((f) => (
          <li key={f.id}>
            {f.shortName}
            <span className="dim">
              　{f.occupation} · 这两周被说起 {f.mentions} 次
            </span>
            　{button("folk", f.id)}
          </li>
        ))}
        {w.openings.map((o) => (
          <li key={o.id}>
            {o.occupation}
            <span className="dim">{o.inSeason ? "　正是时候" : "　不是时候"}</span>　{button("arrival", o.id)}
          </li>
        ))}
      </ul>
    </Fold>
  );
}

export function VillagePage({ today }: { today: string | undefined }) {
  const { data: w, reload } = useDev<World>("/world", 10_000);
  if (!w || !today)
    return (
      <p className="dim">
        <Dots />
      </p>
    );
  if (!w.village) return <p className="dim">还没有村子。</p>;
  const tz = w.village.timeZone;
  const name = namer(w.characters);
  const place = (id: string) => w.locations.find((l) => l.id === id)?.name ?? id;

  return (
    <>
      <Fold title="人" count={w.characters.filter((c) => c.status === "here").length + 1} open>
        <details className="item">
          <summary>
            <span className="who">你</span>
            <span className="dim">
              {place(w.village.playerLocationId)} · {pence(w.village.playerMoney)}
            </span>
          </summary>
          <div className="item-body">
            <p>手上：{goods(w.inventory, "player")}</p>
          </div>
        </details>
        {w.characters.map((c) => (
          <Person key={c.id} c={c} w={w} today={today} />
        ))}
      </Fold>

      <NotYet w={w} reload={reload} />

      <Fold title="约定" count={w.commitments.length}>
        {w.commitments.length ? (
          <ul className="plain">
            {w.commitments.map((x) => (
              <li key={x.id}>
                {name(x.byId)}答应{name(x.toId)}：{x.text}
                <span className="dim">
                  　{STATUS[x.status] ?? x.status}
                  {x.due ? ` · ${when(x.due, tz)}前` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dim">没有。</p>
        )}
      </Fold>

      <Fold title="文书" count={w.documents.length}>
        {w.documents.length ? (
          w.documents.map((d) => (
            <details key={d.id} className="item">
              <summary>
                <span className="who">{d.replyToId ? `${d.recipient ?? name(d.commissionedBy)}的回信` : `${name(d.commissionedBy)}的${KIND[d.kind] ?? d.kind}`}</span>
                <span className="dim">
                  {d.recipient && !d.replyToId ? `给${d.recipient} · ` : ""}
                  {d.replyToId ? (d.readAt ? "念过了" : "还没念") : (DOC_STATUS[d.status] ?? d.status)}
                </span>
              </summary>
              <div className="item-body">
                {d.gist && <p className="dim">“{d.gist}”</p>}
                {d.dictated && (
                  <>
                    <h4>口述</h4>
                    <pre className="text">{d.dictated}</pre>
                  </>
                )}
                {d.written && (
                  <>
                    <h4>{d.replyToId ? "信上写着" : "你写下的"}</h4>
                    <pre className="text">{d.written}</pre>
                  </>
                )}
              </div>
            </details>
          ))
        ) : (
          <p className="dim">没有。</p>
        )}
      </Fold>

      <Fold title="收信人" count={w.remotePeople.length}>
        {w.remotePeople.length ? (
          w.remotePeople.map((p) => (
            <details key={p.id} className="item">
              <summary>
                <span className="who">{p.name}</span>
                <span className="dim">
                  {p.relation} · {p.place}
                  {p.alive ? "" : " · 不在了"}
                </span>
              </summary>
              <div className="item-body">
                <p>{p.description}</p>
              </div>
            </details>
          ))
        ) : (
          <p className="dim">还没有。</p>
        )}
      </Fold>
    </>
  );
}
