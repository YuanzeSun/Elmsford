import { villageMap } from "@elmsford/content";
import { describe, expect, it } from "vitest";
import { testAccounts, testServices } from "./helpers";
import { createApp } from "../src/app";
import { ClockService } from "../src/clock";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db/client";
import { LlmGateway } from "../src/llm/gateway";
import type { Provider, ProviderCall } from "../src/llm/types";
import { ensureVillage, getVillage } from "../src/village";
import { drawMap } from "../src/world/map";

/** The model's drawings, in order. */
function setup(drawings: string[][]) {
  const db = openDb(":memory:");
  const config = { ...loadConfig({}), devMode: true };
  const clock = new ClockService(db, true);
  const calls: ProviderCall[] = [];
  const provider: Provider = {
    async listModels() {
      return [];
    },
    async call(c) {
      calls.push(c);
      // Only map requests take a drawing; anything else (planning…) gets an empty answer.
      const text = c.json?.name === "village_map" ? JSON.stringify({ rows: drawings.shift() ?? [] }) : JSON.stringify({ residents: [] });
      return { text, toolCalls: [], model: c.model, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", refused: false };
    },
  };
  const creds = { anthropic: { file: "x", baseURL: null, apiKey: "k", authToken: null, models: {} }, openai: null, notes: [] };
  const gateway = new LlmGateway({ db, clock, config, credentials: { get: () => creds }, providerFactory: () => provider });
  const app = createApp({ db, clock, gateway, config, ...testServices(db, clock, gateway), ...testAccounts() });
  return { db, gateway, calls, app };
}

const post = (path: string, body: unknown = {}) =>
  new Request(`http://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// A different, valid drawing: the hand-drawn map with its last row all river.
const RIVER = "~".repeat(38);
const drawn = [...villageMap.slice(0, -1), RIVER];

describe("intro", () => {
  it("is shown once per village, with the choice of how the days go", async () => {
    const { app } = setup([]);
    const first = (await (await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }))).json()) as { intro: { paragraphs: string[]; modes: { id: string }[] } | null };
    expect(first.intro?.paragraphs.length).toBeGreaterThan(2);
    // Going at your own pace comes first: it's the one the game is made around.
    expect(first.intro?.modes.map((m) => m.id)).toEqual(["story", "real"]);
    await app.request(post("/api/start", { mode: "real" }));
    const again = (await (await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }))).json()) as { intro: unknown; timeMode: string };
    expect(again).toMatchObject({ intro: null, timeMode: "real" });
    // Once in, it stays.
    expect(await (await app.request(post("/api/start", { mode: "story" }))).json()).toMatchObject({ timeMode: "real" });
  });
});

describe("map", () => {
  it("serves the hand-drawn map, final while drawing is off; a drawn one replaces it", async () => {
    const { app, db, gateway } = setup([drawn]);
    ensureVillage(db, "local", "Asia/Shanghai", Date.now());
    const before = (await (await app.request("/api/map")).json()) as { final: boolean; rows: string[] };
    expect(before.final).toBe(true);
    expect(before.rows[0]!.trimEnd()).toBe(villageMap[0]);

    expect(await drawMap(db, gateway, "local")).toBe(true);
    const after = (await (await app.request("/api/map")).json()) as { final: boolean; rows: string[]; labels: { id: string }[] };
    expect(after.final).toBe(true);
    expect(after.rows.at(-1)!.trimEnd()).toBe(RIVER);
    expect(after.labels.map((l) => l.id)).toContain("player_house");
  });

  it("asks once more with the problems spelled out, then gives up", async () => {
    const bad = ["井边 井边", "~~~~", "....", "....", "....", "....", "....", "...."];
    const { db, gateway, calls } = setup([bad, drawn]);
    ensureVillage(db, "local", "Asia/Shanghai", Date.now());
    expect(await drawMap(db, gateway, "local")).toBe(true);
    expect(calls.at(-1)!.messages.at(-1)!.content).toMatch(/“井边”写了 2 次/);

    const twice = setup([bad, bad]);
    ensureVillage(twice.db, "local", "Asia/Shanghai", Date.now());
    expect(await drawMap(twice.db, twice.gateway, "local")).toBe(false);
    expect(getVillage(twice.db, "local")!.map).toBeNull();
  });
});
