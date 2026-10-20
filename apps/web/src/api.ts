import type { GameTime, TimeDescription, Weather } from "@elmsford/core";

export interface ClockInfo {
  mode: "real" | "fake" | "story";
  speed: number;
  now: number;
}

export interface SimStatus {
  running: boolean;
  simulatedUntil: number | null;
  behindMs: number;
  mode: string | null;
}

export interface NowResponse {
  gameTime: GameTime;
  text: TimeDescription;
  weather: Weather;
  /** Names in the headline the player has been told about, and what they heard. */
  heard: { match: string; lines: HeardLine[] }[];
  clock: ClockInfo;
  sim: SimStatus;
  /** An unseen "这几天" is waiting. */
  recapId: string | null;
  story: StoryNow | null;
  pollMs: number;
}

export interface HeardLine {
  text: string;
  from: string;
  at: number;
}

export interface HeardDay {
  key: string;
  name: string;
  lines: HeardLine[];
}

export interface SessionResponse {
  villageId: string;
  timeZone: string;
  devMode: boolean;
  timeMode: TimeMode;
  /** Shown once, the first time into a new village, with the choice of how the days go. */
  intro: { paragraphs: string[]; hint: string; modes: { id: TimeMode; name: string; text: string }[] } | null;
}

export type TimeMode = "story" | "real";

/** Story mode: which part of the day it is. */
export interface StoryNow {
  segment: "morning" | "afternoon" | "evening";
  name: string;
  /** The next part of today, if any. */
  next: string | null;
}

export interface VillageMap {
  rows: string[];
  labels: { id: string; row: number; col: number; length: number }[];
  /** False while the hand-drawn map stands in for one still being drawn. */
  final: boolean;
}

export interface PersonHere {
  id: string;
  name: string;
  activity: string;
  canTalk: boolean;
  note?: string;
  lookingForYou: boolean;
}

export interface PlaceView {
  location: { id: string; name: string; description: string };
  scene: string;
  people: PersonHere[];
  exits: { id: string; name: string; note?: string }[];
  itemsHere: string | null;
  overheard: { name: string; text: string }[];
  /** What just happened to you, once (someone came while you rested, you went to bed). */
  note: string | null;
}

export interface TranscriptLine {
  speaker: string;
  text: string;
  at: number;
}

export interface ActiveConversation {
  id: string;
  characterId: string;
  name: string;
  transcript: TranscriptLine[];
}

export interface DeskDocument {
  id: string;
  kind: "letter" | "contract" | "will" | "record";
  commissionedBy: string;
  commissionerName: string;
  dictated: string;
  written: string;
  recipient: string | null;
  status: "draft" | "sent" | "delivered" | "replied";
  gist: string;
  createdAt: number;
  sealedAt: number | null;
  sentAt: number | null;
  deliveredAt: number | null;
  readAt: number | null;
  replyToId: string | null;
  canDictate: boolean;
  fee: number;
  feePence: number | null;
}

export interface NotebookPerson {
  id: string;
  name: string;
  status: "here" | "gone" | "dead";
  metAt: number | null;
  notes: { id: string; at: number; text: string; byPlayer: boolean }[];
}

export interface Recap {
  id: string;
  status: "pending" | "ready" | "failed";
  text: string;
  fromAt: number;
  toAt: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === "object" && data && "error" in data ? String(data.error) : res.statusText;
    throw new Error(message);
  }
  return data as T;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  session: () => post<SessionResponse>("/api/session", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  now: () => request<NowResponse>("/api/now"),
  place: () => request<PlaceView>("/api/place"),
  move: (to: string) => post<{ ok: true; place: PlaceView } | { ok: false; reason: string }>("/api/move", { to }),
  pickup: () => post<{ picked: string | null }>("/api/pickup"),
  map: () => request<VillageMap>("/api/map"),
  start: (mode: TimeMode) => post<{ ok: true; timeMode: TimeMode }>("/api/start", { mode }),
  rest: (until: "segment" | "day") => post<{ ok: true; place: PlaceView }>("/api/rest", { until }),
  leave: () => post<{ ok: true }>("/api/leave"),
  me: () => request<{ money: number; moneyText: string; inventory: string }>("/api/me"),
  activeTalk: () => request<ActiveConversation | null>("/api/talk/active"),
  leaveTalk: (id: string) => post<{ ok: true }>(`/api/talk/${id}/leave`),
  desk: () => request<DeskDocument[]>("/api/desk"),
  write: (id: string, written: string) => post<{ ok: true }>(`/api/desk/${id}/write`, { written }),
  seal: (id: string) => post<{ fee: number; owed: number }>(`/api/desk/${id}/seal`),
  notebook: () => request<NotebookPerson[]>("/api/notebook"),
  notebookDays: () => request<HeardDay[]>("/api/notebook/days"),
  addNote: (characterId: string, text: string) => post<{ ok: true }>("/api/notebook", { characterId, text }),
  deleteNote: (id: string) => request<{ ok: true }>(`/api/notebook/${id}`, { method: "DELETE" }),
  recap: () => request<{ recap: Recap | null; sim: SimStatus }>("/api/recap"),
  seenRecap: (id: string) => post<{ ok: true }>(`/api/recap/${id}/seen`),
  notifications: () => request<{ id: string; text: string; characterId: string | null }[]>("/api/notifications"),
  settings: <T>(path: string) => request<T>(`/api/settings${path}`),
  forget: <T>(path: string) => request<T>(`/api/settings${path}`, { method: "DELETE" }),
  saveSetting: <T>(path: string, body: unknown) => post<T>(`/api/settings${path}`, body),
  get: <T>(path: string) => request<T>(`/api/dev${path}`),
  post: <T>(path: string, body: unknown) => post<T>(`/api/dev${path}`, body),
};
