import { useCallback, useEffect, useState } from "react";
import { api, type DeskDocument, type HeardDay, type NotebookPerson } from "../api";

const KIND: Record<DeskDocument["kind"], string> = { letter: "信", contract: "契约", will: "遗嘱", record: "记录" };

function statusText(d: DeskDocument): string {
  if (d.replyToId) return d.readAt ? "念过了" : "还没念";
  if (d.status === "replied") return "回信到了";
  if (d.status === "sent") return "捎走了";
  if (d.sealedAt) return d.kind === "letter" ? "等周四的商贩" : "交出去了";
  if (d.dictated) return "还没写完";
  return "还没口述";
}

function DocCard({ d, atHome, onChange }: { d: DeskDocument; atHome: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(!d.sealedAt && !d.replyToId);
  const [written, setWritten] = useState(d.written);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const editable = !d.sealedAt && !d.replyToId;

  const save = async () => {
    setBusy(true);
    await api.write(d.id, written).then(
      () => setNote("存着了。"),
      (e: unknown) => setNote(e instanceof Error ? e.message : String(e)),
    );
    setBusy(false);
  };

  const sealIt = async () => {
    setBusy(true);
    try {
      await api.write(d.id, written);
      const r = await api.seal(d.id);
      setNote(r.fee > 0 ? `${d.commissionerName}付了你 ${r.fee} 便士${r.owed ? `，还欠 ${r.owed} 便士` : ""}。` : `${d.commissionerName}手头没钱，说先欠着。`);
      onChange();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const title = d.replyToId ? `给${d.commissionerName}的回信` : `${d.commissionerName}的${KIND[d.kind]}${d.recipient ? `，给${d.recipient}` : ""}`;

  return (
    <article className={`doc ${open ? "open" : ""}`}>
      <header onClick={() => setOpen(!open)}>
        <span className="doc-title">{title}</span>
        <span className="dim">{statusText(d)}</span>
      </header>
      {open && (
        <div className="doc-body">
          {d.replyToId ? (
            <pre className="letter">{d.written}</pre>
          ) : (
            <>
              {d.gist && <p className="gist">“{d.gist}”</p>}
              {d.dictated && (
                <>
                  <h4>口述</h4>
                  <pre className="spoken">{d.dictated}</pre>
                </>
              )}
              {editable ? (
                atHome && (
                  <div className="writing">
                    <h4>你写下的</h4>
                    <textarea rows={10} value={written} onChange={(e) => setWritten(e.target.value)} />
                    <div className="row">
                      <button className="quiet" onClick={() => void save()} disabled={busy}>
                        存着
                      </button>
                      <button className="quiet" onClick={() => void sealIt()} disabled={busy || written.trim().length < 10}>
                        封上
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <>
                  <h4>你写下的</h4>
                  <pre className="letter">{d.written}</pre>
                </>
              )}
            </>
          )}
          {note && <p className="note">{note}</p>}
        </div>
      )}
    </article>
  );
}

export function Desk({ atHome }: { atHome: boolean }) {
  const [docs, setDocs] = useState<DeskDocument[] | null>(null);
  const load = useCallback(() => void api.desk().then(setDocs, () => {}), []);
  useEffect(load, [load]);
  if (!docs) return <p className="dim">……</p>;
  return (
    <div className="desk">
      <h2 className="place-name">书桌</h2>
      {!atHome && <p className="dim">你不在屋里。</p>}
      {docs.length === 0 ? <p className="scene">桌上只有你自己的纸笔。</p> : docs.map((d) => <DocCard key={d.id} d={d} atHome={atHome} onChange={load} />)}
    </div>
  );
}

export function Notebook() {
  const [people, setPeople] = useState<NotebookPerson[] | null>(null);
  const [days, setDays] = useState<HeardDay[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    void api.notebook().then(setPeople, () => {});
    void api.notebookDays().then(setDays, () => {});
  }, []);
  useEffect(load, [load]);

  const add = async (id: string) => {
    const text = drafts[id]?.trim();
    if (!text) return;
    await api.addNote(id, text);
    setDrafts({ ...drafts, [id]: "" });
    load();
  };

  const strike = async (noteId: string) => {
    await api.deleteNote(noteId).catch(() => {});
    load();
  };

  if (!people) return <p className="dim">……</p>;
  // Only people you've met, or written about.
  const known = people.filter((p) => p.metAt !== null || p.notes.length > 0);
  return (
    <div className="notebook">
      <h2 className="place-name">笔记本</h2>
      {known.length === 0 && days.length === 0 && <p className="scene">还没记什么。</p>}
      {known.map((p) => (
        <section key={p.id} className="person">
          <h3>
            {p.name}
            {p.status !== "here" && <span className="dim">{p.status === "dead" ? "　不在了" : "　走了"}</span>}
          </h3>
          {p.notes.length > 0 && (
            <ul>
              {p.notes.map((n) => (
                <li key={n.id} className={n.byPlayer ? "mine" : ""}>
                  {n.text}
                  {n.byPlayer && (
                    <button className="quiet strike" onClick={() => void strike(n.id)}>
                      划掉
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <input
            value={drafts[p.id] ?? ""}
            placeholder="记一笔"
            onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void add(p.id)}
          />
        </section>
      ))}
      {days.length > 0 && (
        <section className="days">
          <h2 className="place-name">日子</h2>
          {days.map((d) => (
            <div key={d.key} className="person">
              <h3>{d.name}</h3>
              <ul>
                {d.lines.map((l, i) => (
                  <li key={i}>{l.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
