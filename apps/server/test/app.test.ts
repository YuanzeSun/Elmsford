import { describe, expect, it } from "vitest";
import { testAccounts, testServices } from "./helpers";
import { createApp } from "../src/app";
import { ClockService } from "../src/clock";
import { loadConfig } from "../src/config";
import { openDb } from "../src/db/client";
import { LlmGateway } from "../src/llm/gateway";

function setup(devMode: boolean) {
  const db = openDb(":memory:");
  const config = { ...loadConfig({}), devMode };
  const clock = new ClockService(db, devMode);
  const gateway = new LlmGateway({ db, clock, config, credentials: { get: () => ({ anthropic: null, openai: null, notes: [] }) } });
  return { app: createApp({ db, clock, gateway, config, ...testServices(db, clock, gateway), ...testAccounts() }), clock, db };
}

const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("api", () => {
  it("seeds the village on first session and reports the time", async () => {
    const { app } = setup(true);
    expect((await app.request("/api/now")).status).toBe(409);
    expect((await app.request(post("/api/session", { timeZone: "Nowhere/Land" }))).status).toBe(400);

    const session = await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }));
    expect(await session.json()).toMatchObject({ villageId: "local", devMode: true });

    // 2026-10-20 just after vespers, via the dev clock.
    const jump = await app.request(post("/api/dev/clock", { action: "jump", local: "2026-10-20T16:05" }));
    expect(jump.status).toBe(200);
    const now = (await (await app.request("/api/now")).json()) as { text: { headline: string } };
    expect(now.text.headline).toMatch(/^今天是圣路加节后第二天，/);

    const world = (await (await app.request("/api/dev/world")).json()) as { characters: unknown[]; relationships: unknown[] };
    expect(world.characters).toHaveLength(5);
    expect(world.relationships.length).toBeGreaterThan(20);
  });

  it("hides dev tools outside dev mode", async () => {
    const { app } = setup(false);
    expect((await app.request("/api/dev/clock")).status).toBe(404);
    expect((await app.request(post("/api/dev/clock", { action: "speed", speed: 60 }))).status).toBe(404);
  });

  it("switches a tier's model and back", async () => {
    const { app } = setup(true);
    const bad = await app.request(post("/api/settings/llm/selection", { tier: "cheap", spec: "haiku" }));
    expect(bad.status).toBe(400);
    const set = await app.request(post("/api/settings/llm/selection", { tier: "cheap", spec: "openai:gpt-5.4-mini" }));
    expect(await set.json()).toMatchObject({ selection: { cheap: "openai:gpt-5.4-mini" } });
    const cleared = await app.request(post("/api/settings/llm/selection", { tier: "cheap", spec: null }));
    expect(await cleared.json()).toMatchObject({ selection: {} });
  });

  it("reports missing credentials instead of crashing", async () => {
    const { app } = setup(true);
    await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }));
    const r = await app.request(post("/api/dev/style-judge", { text: "阁下请随我来。" }));
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ kind: "unavailable" });
  });
});

describe("customs", () => {
  it("can be seen around the village, not explained", async () => {
    const { app } = setup(true);
    await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }));
    await app.request(post("/api/dev/clock", { action: "jump", local: "2026-11-02T18:30" }));
    await app.request(post("/api/move", { to: "green" }));
    await app.request(post("/api/move", { to: "church" }));
    await app.request(post("/api/move", { to: "churchyard" }));
    const place = (await (await app.request("/api/place")).json()) as { scene: string };
    expect(place.scene).toMatch(/蜡烛/);
    const now = (await (await app.request("/api/now")).json()) as { text: Record<string, unknown>; heard: unknown[] };
    expect(now.heard).toEqual([]);
  });
});

describe("leaving", () => {
  it("ends this village; the next session starts a new one, with the intro", async () => {
    const { app } = setup(true);
    await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }));
    await app.request(post("/api/intro/seen", {}));
    await app.request(post("/api/notebook", { characterId: "joan", text: "她会唱歌" }));
    expect((await app.request(post("/api/leave", {}))).status).toBe(200);
    expect((await app.request("/api/now")).status).toBe(409);

    const fresh = (await (await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }))).json()) as { intro: unknown };
    expect(fresh.intro).not.toBeNull();
    const book = (await (await app.request("/api/notebook")).json()) as { notes: unknown[] }[];
    expect(book.every((p) => p.notes.length === 0)).toBe(true);
  });
});

describe("notebook", () => {
  it("lets the player cross out only their own lines", async () => {
    const { app } = setup(true);
    await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }));
    await app.request(post("/api/notebook", { characterId: "joan", text: "她会唱歌" }));
    const book = (await (await app.request("/api/notebook")).json()) as { id: string; notes: { id: string; text: string }[] }[];
    const line = book.find((p) => p.id === "joan")!.notes[0]!;
    expect((await app.request(`/api/notebook/${line.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await app.request(`/api/notebook/${line.id}`, { method: "DELETE" })).status).toBe(404);
    const after = (await (await app.request("/api/notebook")).json()) as { id: string; notes: unknown[] }[];
    expect(after.find((p) => p.id === "joan")!.notes).toEqual([]);
  });
});

describe("save files", () => {
  it("round-trips a village", async () => {
    const { app } = setup(true);
    await app.request(post("/api/session", { timeZone: "Asia/Shanghai" }));
    await app.request(post("/api/notebook", { characterId: "hubert", text: "他的弟弟在北边" }));
    const save = (await (await app.request("/api/save")).json()) as { format: string; tables: { characters: unknown[]; notebook: unknown[] } };
    expect(save.format).toBe("elmsford-save/1");
    expect(save.tables.characters).toHaveLength(5);

    const fresh = setup(true);
    await fresh.app.request(post("/api/session", { timeZone: "Europe/London" }));
    const imported = await fresh.app.request(post("/api/dev/save/import", save));
    expect(imported.status).toBe(200);
    const book = (await (await fresh.app.request("/api/notebook")).json()) as { id: string; notes: { text: string }[] }[];
    expect(book.find((p) => p.id === "hubert")!.notes.map((n) => n.text)).toEqual(["他的弟弟在北边"]);
  });
});
