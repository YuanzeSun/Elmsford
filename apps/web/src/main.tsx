import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type SessionResponse } from "./api";
import { Dots } from "./views/Dots";
import { Intro } from "./views/Intro";
import { Settings } from "./views/Settings";
import { usePalette } from "./palette";
import { useNow } from "./useNow";
import { Village } from "./Village";
import "./styles.css";

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const { now, error: nowError, refresh } = useNow(session !== null);
  // Every page takes its colours from the village's hour.
  usePalette(now?.gameTime);

  useEffect(() => {
    api.session().then(setSession, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // One page for settings and, in dev mode, the dev tools.
  if (location.pathname.startsWith("/settings")) {
    return <Settings now={now} devMode={session?.devMode ?? false} refreshNow={refresh} />;
  }

  const problem = error ?? (now ? null : nowError);
  if (problem) return <p className="loading">连不上村子。</p>;
  if (!now || !session)
    return (
      <p className="loading">
        <Dots />
      </p>
    );
  if (session.intro && !introDone) {
    return (
      <main className="page">
        <Intro
          {...session.intro}
          onDone={(mode) =>
            // The day starts when you walk in; a story village sets its clock to the morning.
            void api.start(mode).then(
              () => {
                setIntroDone(true);
                refresh();
              },
              () => setError("连不上村子。"),
            )
          }
        />
      </main>
    );
  }
  return <Village now={now} onMoved={refresh} />;
}

// The offline shell only in a production build; in dev it would cache stale modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
