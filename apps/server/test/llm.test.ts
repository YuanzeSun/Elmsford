import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig, type ServerConfig } from "../src/config";
import { openDb } from "../src/db/client";
import { llmCalls } from "../src/db/schema";
import { describeCredentials, discoverCredentials, type DiscoveredCredentials } from "../src/llm/credentials";
import { LlmError, LlmGateway, toWireSchema } from "../src/llm/gateway";
import { parseModelSpec, resolveRoute } from "../src/llm/routes";
import type { Provider, ProviderCall, ProviderId } from "../src/llm/types";
import { ensureVillage } from "../src/village";

function fixtureDirs(files: { claude?: unknown; codexToml?: string; codexAuth?: unknown }) {
  const root = mkdtempSync(join(tmpdir(), "elmsford-"));
  const claude = join(root, ".claude");
  const codex = join(root, ".codex");
  mkdirSync(claude);
  mkdirSync(codex);
  if (files.claude !== undefined) writeFileSync(join(claude, "settings.json"), JSON.stringify(files.claude));
  if (files.codexToml !== undefined) writeFileSync(join(codex, "config.toml"), files.codexToml);
  if (files.codexAuth !== undefined) writeFileSync(join(codex, "auth.json"), JSON.stringify(files.codexAuth));
  return { claude, codex };
}

const RELAY_TOML = `
model_provider = "OpenAI"
model = "gpt-6.1-sol"
model_reasoning_effort = "xhigh"

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://relay.example"
wire_api = "responses"
requires_openai_auth = true

[projects."/some/path"]
trust_level = "trusted"
`;

describe("reading CLI configs", () => {
  it("reads Claude Code's settings.json env block", () => {
    const dirs = fixtureDirs({
      claude: { env: { ANTHROPIC_BASE_URL: "https://relay.example", ANTHROPIC_AUTH_TOKEN: "tok-123", ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-x" } },
    });
    const creds = discoverCredentials(dirs.claude, dirs.codex, {});
    expect(creds.anthropic).toMatchObject({ baseURL: "https://relay.example", authToken: "tok-123", apiKey: null, models: { cheap: "claude-haiku-x" } });
  });

  it("reads Codex's provider from config.toml and the key from auth.json", () => {
    const dirs = fixtureDirs({ codexToml: RELAY_TOML, codexAuth: { OPENAI_API_KEY: "sk-abc" } });
    const creds = discoverCredentials(dirs.claude, dirs.codex, {});
    expect(creds.openai).toMatchObject({ providerId: "OpenAI", baseURL: "https://relay.example", wireApi: "responses", apiKey: "sk-abc", model: "gpt-6.1-sol" });
  });

  it("honours Codex profiles and env_key providers", () => {
    const toml = `
profile = "work"
[profiles.work]
model = "m-work"
model_provider = "acme"
[model_providers.acme]
base_url = "https://acme.example/v1"
env_key = "ACME_KEY"
`;
    const dirs = fixtureDirs({ codexToml: toml });
    const creds = discoverCredentials(dirs.claude, dirs.codex, { ACME_KEY: "k" });
    expect(creds.openai).toMatchObject({ providerId: "acme", model: "m-work", wireApi: "chat", apiKey: "k" });
  });

  it("refuses subscription logins and explains why", () => {
    const dirs = fixtureDirs({ claude: { env: {} }, codexAuth: { tokens: { access_token: "x" } } });
    const creds = discoverCredentials(dirs.claude, dirs.codex, {});
    expect(creds.anthropic).toBeNull();
    expect(creds.openai).toBeNull();
    expect(creds.notes.join("\n")).toMatch(/订阅账号/);
    expect(creds.notes.join("\n")).toMatch(/ChatGPT 账号登录/);
  });

  it("never exposes secrets in the description", () => {
    const dirs = fixtureDirs({
      claude: { env: { ANTHROPIC_AUTH_TOKEN: "secret-claude" } },
      codexToml: RELAY_TOML,
      codexAuth: { OPENAI_API_KEY: "secret-codex" },
    });
    const text = JSON.stringify(describeCredentials(discoverCredentials(dirs.claude, dirs.codex, {})));
    expect(text).not.toContain("secret-claude");
    expect(text).not.toContain("secret-codex");
  });
});

describe("routing tiers to models", () => {
  const config = loadConfig({});
  const both: DiscoveredCredentials = {
    anthropic: { file: "s.json", baseURL: null, apiKey: "a", authToken: null, models: { planner: "claude-custom" } },
    openai: { files: ["c.toml"], providerId: "OpenAI", baseURL: "u", wireApi: "responses", apiKey: "o", headers: {}, query: {}, model: "gpt-x" },
    notes: [],
  };

  it("prefers Claude, with models from settings or defaults", () => {
    expect(resolveRoute("planner", config, both)).toMatchObject({ ok: true, route: { provider: "anthropic", model: "claude-custom" } });
    expect(resolveRoute("cheap", config, both)).toMatchObject({ ok: true, route: { provider: "anthropic", model: config.defaultClaudeModels.cheap } });
  });

  it("falls back to Codex when Claude has no credentials", () => {
    expect(resolveRoute("dialogue", config, { ...both, anthropic: null })).toMatchObject({ ok: true, route: { provider: "openai", model: "gpt-x" } });
  });

  it("puts a manual choice above MODEL_* and the CLI config", () => {
    const withOverride: ServerConfig = { ...config, modelOverrides: { cheap: "openai:gpt-mini" } };
    expect(resolveRoute("cheap", withOverride, both, { cheap: "anthropic:claude-haiku-4-5" })).toMatchObject({
      ok: true,
      route: { provider: "anthropic", model: "claude-haiku-4-5", from: "手动选择" },
    });
    expect(resolveRoute("cheap", withOverride, { ...both, anthropic: null }, { cheap: "anthropic:x" })).toMatchObject({ ok: false });
  });

  it("lets MODEL_* pick a provider explicitly", () => {
    const withOverride: ServerConfig = { ...config, modelOverrides: { cheap: "openai:gpt-mini" } };
    expect(resolveRoute("cheap", withOverride, both)).toMatchObject({ ok: true, route: { provider: "openai", model: "gpt-mini" } });
    expect(parseModelSpec("claude-opus-5-5")).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(parseModelSpec("codex:gpt-6.1-sol")).toEqual({ provider: "openai", model: "gpt-6.1-sol" });
  });
});

describe("gateway", () => {
  const creds: DiscoveredCredentials = {
    anthropic: { file: "s.json", baseURL: null, apiKey: "a", authToken: null, models: {} },
    openai: null,
    notes: [],
  };

  function setup(overrides: Partial<ServerConfig> = {}, reply = '{"ok":true}', opts: { rejectEffort?: boolean } = {}) {
    const db = openDb(":memory:");
    const now = Date.UTC(2026, 9, 20, 8, 0);
    ensureVillage(db, "v", "Asia/Shanghai", now);
    const calls: ProviderCall[] = [];
    const provider: Provider = {
      async listModels() {
        return ["claude-z", "claude-a"];
      },
      async call(c) {
        calls.push(c);
        if (opts.rejectEffort && c.effort) throw Object.assign(new Error("400 output_config.effort: not supported"), { status: 400 });
        c.onText?.(reply);
        return { text: reply, toolCalls: [], model: c.model, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", refused: false };
      },
    };
    const config = { ...loadConfig({}), ...overrides };
    const gateway = new LlmGateway({ db, clock: { now: () => now }, config, credentials: { get: () => creds }, providerFactory: () => provider });
    return { db, gateway, calls, config };
  }

  const req = { tier: "dialogue" as const, purpose: "test", villageId: "v", system: [{ text: "s", cache: true }], messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100 };

  it("logs every call with tokens and cost", async () => {
    const { db, gateway } = setup();
    const r = await gateway.call(req);
    const rows = db.select().from(llmCalls).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.callId, status: "ok", inputTokens: 1000, outputTokens: 100, gameDate: "2026-10-20", provider: "anthropic" });
    expect(rows[0]!.costUsd).toBeGreaterThan(0);
  });

  it("streams text deltas", async () => {
    const { gateway } = setup({}, "你好");
    const deltas: string[] = [];
    await gateway.call({ ...req, onText: (d) => deltas.push(d) });
    expect(deltas.join("")).toBe("你好");
  });

  it("downgrades to the cheap tier once the village is over budget", async () => {
    const { gateway, calls, config } = setup({ villageDailyBudgetUsd: 0.000001 });
    await gateway.call(req);
    const second = await gateway.call(req);
    expect(second.degraded).toBe(true);
    expect(calls[1]!.model).toBe(config.defaultClaudeModels.cheap);
  });

  it("refuses calls past the global daily cap, and logs that too", async () => {
    const { db, gateway } = setup({ globalDailyCapUsd: 0.000001 });
    await gateway.call(req);
    await expect(gateway.call(req)).rejects.toBeInstanceOf(LlmError);
    expect(db.select().from(llmCalls).all().map((r) => r.status)).toEqual(["ok", "over_budget"]);
  });

  it("uses a model chosen in the dev tools, and remembers it", async () => {
    const { db, gateway, calls } = setup();
    gateway.setSelection("dialogue", "anthropic:claude-picked");
    await gateway.call(req);
    expect(calls[0]!.model).toBe("claude-picked");
    expect((await gateway.status()).routes[0]).toMatchObject({ model: "claude-picked", from: "手动选择" });

    // Survives a new gateway on the same database.
    const again = new LlmGateway({ db, clock: { now: () => 0 }, config: loadConfig({}), credentials: { get: () => creds } });
    expect(again.getSelection()).toEqual({ dialogue: "anthropic:claude-picked" });

    gateway.setSelection("dialogue", null);
    expect(gateway.getSelection()).toEqual({});
  });

  it("lets a tier's thinking level override the call's own, and go back", async () => {
    const { gateway, calls } = setup();
    gateway.setEffort("dialogue", "high");
    await gateway.call({ ...req, effort: "low" });
    await gateway.call({ ...req, tier: "cheap", effort: "low" });
    expect(calls.map((c) => c.effort)).toEqual(["high", "low"]);
    expect((await gateway.status()).efforts).toEqual({ dialogue: "high" });
    gateway.setEffort("dialogue", null);
    await gateway.call({ ...req, effort: "low" });
    expect(calls.at(-1)!.effort).toBe("low");
  });

  it("retries without effort for models that reject it, then stops sending it", async () => {
    const { gateway, calls } = setup({}, '{"ok":true}', { rejectEffort: true });
    await gateway.call({ ...req, effort: "low" });
    await gateway.call({ ...req, effort: "low" });
    expect(calls.map((c) => c.effort ?? null)).toEqual(["low", null, null]);
  });

  it("moves the defaults to Codex when the Claude endpoint won't answer this app", async () => {
    const db = openDb(":memory:");
    const both: DiscoveredCredentials = {
      anthropic: { file: "s.json", baseURL: "https://relay", apiKey: null, authToken: "t", models: {} },
      openai: { files: ["c.toml"], providerId: "OpenAI", baseURL: "https://relay", wireApi: "responses", apiKey: "o", headers: {}, query: {}, model: "gpt-x" },
      notes: [],
    };
    const seen: string[] = [];
    const factory = (id: ProviderId): Provider => ({
      async listModels() {
        return [];
      },
      async call(c) {
        seen.push(`${id}:${c.model}`);
        if (id === "anthropic") throw Object.assign(new Error("400 请使用标准 Claude Code 客户端"), { status: 400 });
        return { text: "好", toolCalls: [], model: c.model, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn", refused: false };
      },
    });
    const gateway = new LlmGateway({ db, clock: { now: () => Date.now() }, config: loadConfig({}), credentials: { get: () => both }, providerFactory: factory });
    const r = await gateway.call({ ...req, villageId: undefined });
    expect(r).toMatchObject({ provider: "openai", model: "gpt-x" });
    await gateway.call({ ...req, villageId: undefined });
    // One probe each, then straight to Codex.
    expect(seen.filter((x) => x.startsWith("anthropic"))).toHaveLength(1);

    // An explicit choice is never second-guessed.
    gateway.setSelection("dialogue", "anthropic:claude-picked");
    await expect(gateway.call({ ...req, villageId: undefined })).rejects.toThrow(/Claude Code/);
  });

  it("lists the models each endpoint offers", async () => {
    const { gateway } = setup();
    const catalog = await gateway.listModels();
    expect(catalog.anthropic).toMatchObject({ ok: true, models: ["claude-a", "claude-z"] });
    expect(catalog.openai).toBeNull();
  });

  it("validates structured output", async () => {
    const { gateway } = setup({}, '{"ok":true}');
    const r = await gateway.callJson(req, "t", z.object({ ok: z.boolean() }));
    expect(r.data.ok).toBe(true);
    await expect(gateway.callJson(req, "t", z.object({ ok: z.string() }))).rejects.toThrow(/结构化输出/);
  });

  it("builds a wire schema without unsupported keywords", () => {
    const schema = toWireSchema(z.object({ n: z.number().int() }));
    expect(JSON.stringify(schema)).not.toMatch(/\$schema|minimum|maximum/);
  });
});
