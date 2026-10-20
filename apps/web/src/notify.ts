// Gentle notifications (技术设计 §5): only when someone is looking for you, capped per day by
// the server. Shown in-page; also as a system notification when the tab is in the background
// and the player has allowed it.

import { VILLAGE } from "@elmsford/content/names";
import { api } from "./api";

const KEY = "elmsford.notify";

/** "unsupported" and "denied" can't be changed from the page, so the switch isn't offered. */
export type NotifyState = "unsupported" | "denied" | "on" | "off";

export function notifyState(): NotifyState {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return localStorage.getItem(KEY) === "off" ? "off" : "on";
  return "off";
}

/** The browser's permission can't be taken back from a page, so "off" is our own switch. */
export async function setNotify(on: boolean): Promise<NotifyState> {
  if (!on) {
    localStorage.setItem(KEY, "off");
    return notifyState();
  }
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") localStorage.setItem(KEY, "on");
  return notifyState();
}

export function pollNotifications(show: (text: string) => void): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      for (const n of await api.notifications()) {
        show(n.text);
        if (document.hidden && notifyState() === "on") {
          const reg = await navigator.serviceWorker?.getRegistration();
          if (reg) await reg.showNotification(VILLAGE, { body: n.text, tag: n.id });
          else new Notification(VILLAGE, { body: n.text, tag: n.id });
        }
      }
    } catch {
      // Offline or server restarting; try again next time.
    }
    if (!stopped) setTimeout(tick, 30_000);
  };
  void tick();
  return () => {
    stopped = true;
  };
}
