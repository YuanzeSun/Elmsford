import { useEffect, useRef, useState } from "react";
import { api, type ActiveConversation, type DeskDocument, type TranscriptLine } from "../api";
import { postStream, type StreamEvent } from "../sse";
import { Dots } from "./Dots";

interface Line {
  who: "player" | "them" | "action" | "scene" | "system";
  text: string;
}

function toLines(transcript: TranscriptLine[], characterId: string): Line[] {
  return transcript.map((l) =>
    l.speaker === "player"
      ? { who: "player", text: l.text }
      : l.speaker === characterId
        ? { who: "them", text: l.text }
        : l.speaker === "narration"
          ? { who: "action", text: l.text }
          : { who: "scene", text: l.text },
  );
}

/** Render "*动作*" segments in italics. */
function Speech({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
          <em key={i} className="gesture">
            {p.slice(1, -1)}
          </em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function Conversation({
  initial,
  starting,
  onClosed,
  onTurn,
}: {
  initial: ActiveConversation | null;
  /** Set when the player just walked up to someone. */
  starting: { characterId: string; name: string } | null;
  onClosed: () => void;
  /** After each exchange (story mode: the clock moved). */
  onTurn?: () => void;
}) {
  const [conv, setConv] = useState<{ id: string; characterId: string; name: string } | null>(initial);
  const [lines, setLines] = useState<Line[]>(initial ? toLines(initial.transcript, initial.characterId) : []);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [papers, setPapers] = useState<DeskDocument[]>([]);
  const [reading, setReading] = useState<{ doc: DeskDocument; text: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const handle = (e: StreamEvent, acc: { text: string }) => {
    // Dictation streams its own "start"; the conversation already has one.
    if (e.type === "start") setConv((c) => c ?? { id: e.conversationId, characterId: e.characterId, name: e.name });
    else if (e.type === "text") {
      acc.text += e.delta;
      setStreaming(acc.text);
    } else if (e.type === "action") {
      if (acc.text) {
        const said = acc.text;
        setLines((ls) => [...ls, { who: "them", text: said }]);
        acc.text = "";
        setStreaming("");
      }
      setLines((ls) => [...ls, { who: "action", text: e.text }]);
    } else if (e.type === "scene") {
      if (acc.text) {
        const said = acc.text;
        setLines((ls) => [...ls, { who: "them", text: said }]);
        acc.text = "";
        setStreaming("");
      }
      setLines((ls) => [...ls, { who: "scene", text: e.text }]);
    } else if (e.type === "end") setEnded(e.text || "这段话说完了。");
    else if (e.type === "error") setLines((ls) => [...ls, { who: "system", text: e.message }]);
  };

  const run = async (path: string, body: unknown, optimistic?: Line) => {
    setBusy(true);
    if (optimistic) setLines((ls) => [...ls, optimistic]);
    const acc = { text: "" };
    try {
      await postStream(path, body, (e) => handle(e, acc));
    } catch (err) {
      console.error(err);
      setLines((ls) => [...ls, { who: "system", text: "连不上村子。" }]);
    }
    if (acc.text) setLines((ls) => [...ls, { who: "them", text: acc.text }]);
    setStreaming("");
    setBusy(false);
    onTurn?.();
  };

  useEffect(() => {
    if (starting && !started.current) {
      started.current = true;
      void run("/api/talk", { characterId: starting.characterId });
    }
  }, [starting]);

  useEffect(() => {
    if (!conv) return;
    api.desk().then((docs) => setPapers(docs.filter((d) => d.commissionedBy === conv.characterId)), () => {});
  }, [conv?.characterId, lines.length]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [lines, streaming, ended]);

  const say = () => {
    const text = input.trim();
    if (!text || !conv || busy) return;
    setInput("");
    void run(`/api/talk/${conv.id}/say`, { text }, { who: "player", text });
  };

  const read = () => {
    if (!reading || !conv || busy) return;
    const { doc, text } = reading;
    setReading(null);
    void run(`/api/talk/${conv.id}/read`, { documentId: doc.id, text }, { who: "player", text: `*展开信，一字一句念*「${text}」` });
  };

  // What this person has on the scribe's desk: a reply waiting to be read to them, or a
  // commission they haven't dictated yet — they're right here, so they can.
  const replies = papers.filter((d) => d.replyToId && d.status === "delivered" && !d.readAt);
  const undictated = papers.filter((d) => !d.replyToId && !d.sealedAt && !d.dictated);

  const dictate = (doc: DeskDocument) => {
    if (busy) return;
    void run(`/api/desk/${doc.id}/dictate`, {});
  };

  const leave = async () => {
    if (conv && !ended) await api.leaveTalk(conv.id).catch(() => {});
    onClosed();
  };

  const name = conv?.name ?? starting?.name ?? "";

  return (
    <section className="conversation" aria-label={`和${name}说话`}>
      <div className="lines">
        {lines.map((l, i) => (
          <p key={i} className={`line ${l.who}`}>
            {l.who === "them" && <span className="speaker">{name}</span>}
            {l.who === "player" && <span className="speaker">你</span>}
            <Speech text={l.text} />
          </p>
        ))}
        {streaming && (
          <p className="line them">
            <span className="speaker">{name}</span>
            <Speech text={streaming} />
          </p>
        )}
        {busy && !streaming && (
          <p className="line pending">
            <Dots />
          </p>
        )}
        {ended && <p className="line ended">{ended}</p>}
        <div ref={bottom} />
      </div>

      {reading && (
        <div className="reading">
          <textarea rows={8} value={reading.text} onChange={(e) => setReading({ ...reading, text: e.target.value })} />
          <div className="row">
            <button onClick={read} disabled={busy}>
              念
            </button>
            <button className="quiet" onClick={() => setReading(null)}>
              算了
            </button>
          </div>
        </div>
      )}

      {!ended ? (
        <div className="say">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                say();
              }
            }}
            disabled={busy || !conv}
          />
          <div className="row">
            <button onClick={say} disabled={busy || !conv || !input.trim()}>
              说
            </button>
            {undictated.slice(0, 1).map((d) => (
              <button key={d.id} className="quiet" onClick={() => dictate(d)} disabled={busy}>
                听口述
              </button>
            ))}
            {replies.map((d) => (
              <button key={d.id} className="quiet" onClick={() => setReading({ doc: d, text: d.written })} disabled={busy}>
                念回信
              </button>
            ))}
            <button className="quiet" onClick={() => void leave()} disabled={busy && !conv}>
              走开
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button onClick={onClosed}>好</button>
        </div>
      )}
    </section>
  );
}
