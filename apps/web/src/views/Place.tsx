import { useCallback, useEffect, useState } from "react";
import { api, type ActiveConversation, type PlaceView, type StoryNow } from "../api";
import { Conversation } from "./Conversation";
import { MapView } from "./Map";

/** Where you are. `story` is set in story mode: then you can also rest, and time moves as you go. */
export function Place({ onMoved, story }: { onMoved: () => void; story: StoryNow | null }) {
  const [place, setPlace] = useState<PlaceView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [talk, setTalk] = useState<{ initial: ActiveConversation | null; starting: { characterId: string; name: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resting, setResting] = useState(false);

  const refresh = useCallback(() => {
    api.place().then(
      (p) => {
        setPlace(p);
        if (p.note) setNote(p.note);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    refresh();
    api.activeTalk().then((c) => c && setTalk({ initial: c, starting: null }), () => {});
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const go = async (to: string) => {
    setNote(null);
    const r = await api.move(to).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
    if (r.ok) {
      setPlace(r.place);
      setNote(r.place.note);
      setTalk(null);
      onMoved();
    } else setNote(r.reason);
  };

  const rest = async (until: "segment" | "day") => {
    setNote(null);
    setResting(true);
    const r = await api.rest(until).catch(() => null);
    setResting(false);
    if (!r) return setNote("连不上村子。");
    setPlace(r.place);
    setNote(r.place.note);
    onMoved();
  };

  const pickUp = async () => {
    const r = await api.pickup();
    if (r.picked) setNote(`你把${r.picked}拿进了屋。`);
    refresh();
  };

  if (error && !place) return <p className="dim">……</p>;
  if (!place) return <p className="dim">……</p>;

  return (
    <div className="place">
      <h2 className="place-name">{place.location.name}</h2>
      <p className="scene">{place.scene}</p>

      {place.people.length > 0 && (
        <ul className="people">
          {place.people.map((p) => (
            <li key={p.id} className={p.lookingForYou ? "seeking" : ""}>
              <span className="who">{p.name}</span>
              <span className="doing">{p.activity}</span>
              {p.canTalk && !talk ? (
                <>
                  {p.note && <span className="dim">（{p.note}）</span>}
                  <button className="quiet" onClick={() => setTalk({ initial: null, starting: { characterId: p.id, name: p.name } })}>
                    {p.lookingForYou && place.location.id === "player_house" ? "开门" : "过去说话"}
                  </button>
                </>
              ) : p.note ? (
                <span className="dim">（{p.note}）</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {place.overheard.length > 0 && !talk && (
        <div className="overheard">
          {place.overheard.map((l, i) => (
            <p key={i}>
              <span className="speaker">{l.name}</span>
              {l.text}
            </p>
          ))}
        </div>
      )}

      {place.itemsHere && (
        <p className="items">
          这儿放着：{place.itemsHere}{" "}
          {place.location.id === "player_house" && (
            <button className="quiet" onClick={() => void pickUp()}>
              拿进屋
            </button>
          )}
        </p>
      )}

      {talk && (
        <Conversation
          key={talk.initial?.id ?? talk.starting?.characterId}
          initial={talk.initial}
          starting={talk.starting}
          onClosed={() => {
            setTalk(null);
            refresh();
            onMoved();
          }}
          onTurn={story ? onMoved : undefined}
        />
      )}

      {note && <p className="note">{note}</p>}

      {!talk && (
        <nav className="exits" aria-label="往哪儿去">
          {place.exits.map((e) => (
            <button key={e.id} className="exit" onClick={() => void go(e.id)}>
              {e.name}
              {e.note && <span className="dim">（{e.note}）</span>}
            </button>
          ))}
        </nav>
      )}

      {!talk && story && (
        <p className="rest">
          <span className="inline-choices">
            <button disabled={resting} onClick={() => void rest("segment")}>
              {story.next ? `歇到${story.next}` : "回家睡下"}
            </button>
            {story.next && (
              <button disabled={resting} onClick={() => void rest("day")}>
                过完今天
              </button>
            )}
          </span>
        </p>
      )}

      {!talk && <MapView here={place.location.id} near={place.exits.map((e) => e.id)} onGo={(id) => void go(id)} />}
    </div>
  );
}
