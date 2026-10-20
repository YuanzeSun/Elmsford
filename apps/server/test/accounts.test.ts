// The in-app accounts, against fake endpoints (no real ChatGPT account or DeepSeek key here).

import { generateKeyPairSync, sign } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pickDefaultModel, verifyIdToken } from "../src/llm/chatgpt";
import { CredentialStore } from "../src/llm/credentials";
import { deepseekProvider } from "../src/llm/providers";
import { loadConfig } from "../src/config";
import { resolveRoute } from "../src/llm/routes";
import { testAccounts } from "./helpers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };

function idToken(claims: Record<string, unknown>, kid = "k1") {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "RS256", kid, typ: "JWT" });
  const body = enc(claims);
  return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
}

interface Seen {
  url: string;
  body: URLSearchParams | null;
  auth: string | null;
}

/** A fake auth.openai.com + api.openai.com, recording every request. */
function fakeOpenAI(opts: { grantPlan: boolean; nonce: () => string }) {
  const seen: Seen[] = [];
  let issued = 0;
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? new URLSearchParams(init.body) : null;
    seen.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/.well-known/jwks.json")) return json({ keys: [jwk] });
    if (url.endsWith("/oauth/token")) {
      issued++;
      const clientId = body!.get("client_id")!;
      return json({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
        expires_in: 3600,
        scope: opts.grantPlan ? "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct" : "openid profile email",
        ...(body!.get("grant_type") === "authorization_code"
          ? { id_token: idToken({ iss: "https://auth.openai.com", aud: clientId, exp: Date.now() / 1000 + 600, nonce: opts.nonce(), email: "a@b.c", name: "阿兰" }) }
          : {}),
      });
    }
    if (url.endsWith("/v1/models")) return json({ data: [{ id: "gpt-5.5" }, { id: "gpt-6.1-sol" }, { id: "gpt-6.1-mini" }] });
    if (url.endsWith("/oauth/revoke")) return new Response(null, { status: 200 });
    return json({ error: "unexpected" }, 404);
  }) as typeof fetch;
  return { http, seen };
}

describe("Sign in with ChatGPT", () => {
  it("registers on first sign-in, exchanges with the issued client id, keeps tokens private", async () => {
    let nonce = "";
    const fake = fakeOpenAI({ grantPlan: true, nonce: () => nonce });
    const { accounts, chatgpt } = testAccounts(fake.http);

    const url = new URL(chatgpt.start("http://127.0.0.1:5173/settings"));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:8787/auth/callback");
    expect(q.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
    expect(q.get("resource")).toBe("https://api.openai.com/v1");
    expect(q.get("code_challenge_method")).toBe("S256");
    nonce = q.get("nonce")!;

    const r = await chatgpt.finish(new URLSearchParams({ code: "c1", state: q.get("state")!, client_id: "oaiapp_123" }));
    expect(r).toEqual({ returnTo: "http://127.0.0.1:5173/settings", outcome: "ok" });
    const token = fake.seen.find((s) => s.url.endsWith("/oauth/token"))!.body!;
    expect(token.get("client_id")).toBe("oaiapp_123");
    expect(token.get("resource")).toBe("https://api.openai.com/v1");
    expect(token.get("code_verifier")).toBeTruthy();

    const rec = chatgpt.record();
    expect(rec).toMatchObject({ clientId: "oaiapp_123", email: "a@b.c", canUsePlan: true, defaultModel: "gpt-6.1-sol" });
    expect(statSync(join((accounts as unknown as { dir: string }).dir, "chatgpt.json")).mode & 0o777).toBe(0o600);

    // The next sign-in reuses the issued client.
    const again = new URL(chatgpt.start("http://127.0.0.1:5173/settings")).searchParams;
    expect(again.get("client_id")).toBe("oaiapp_123");
    expect(again.get("ext_agent_host_id")).toBeNull();
    expect(again.get("login_hint")).toBe("a@b.c");
  });

  it("doesn't use the plan when the account didn't grant it", async () => {
    let nonce = "";
    const fake = fakeOpenAI({ grantPlan: false, nonce: () => nonce });
    const { chatgpt } = testAccounts(fake.http);
    const q = new URL(chatgpt.start("http://127.0.0.1:5173/settings")).searchParams;
    nonce = q.get("nonce")!;
    expect((await chatgpt.finish(new URLSearchParams({ code: "c", state: q.get("state")!, client_id: "oaiapp_9" }))).outcome).toBe("noplan");
    expect(chatgpt.record().canUsePlan).toBe(false);
  });

  it("refuses unknown state, and a denied consent", async () => {
    const { chatgpt } = testAccounts(fakeOpenAI({ grantPlan: true, nonce: () => "" }).http);
    expect((await chatgpt.finish(new URLSearchParams({ code: "c", state: "nope" }))).outcome).toBe("error");
    const q = new URL(chatgpt.start("http://127.0.0.1:5173/settings")).searchParams;
    expect((await chatgpt.finish(new URLSearchParams({ error: "access_denied", state: q.get("state")! }))).outcome).toBe("denied");
  });

  it("refreshes an expiring token once, and signs out by revoking", async () => {
    let nonce = "";
    const fake = fakeOpenAI({ grantPlan: true, nonce: () => nonce });
    const { chatgpt } = testAccounts(fake.http);
    const q = new URL(chatgpt.start("http://127.0.0.1:5173/settings")).searchParams;
    nonce = q.get("nonce")!;
    await chatgpt.finish(new URLSearchParams({ code: "c", state: q.get("state")!, client_id: "oaiapp_1" }));
    expect(await chatgpt.accessToken()).toBe("access-1");

    chatgpt.invalidate();
    const [a, b] = await Promise.all([chatgpt.accessToken(), chatgpt.accessToken()]);
    expect(a).toBe("access-2");
    expect(b).toBe("access-2");
    const refreshes = fake.seen.filter((s) => s.body?.get("grant_type") === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.body!.get("refresh_token")).toBe("refresh-1");

    await chatgpt.signOut();
    expect(fake.seen.at(-1)!.url).toBe("https://auth.openai.com/api/accounts/oauth/revoke");
    expect(chatgpt.record()).toMatchObject({ tokens: null, clientId: "oaiapp_1" });
  });

  it("checks the ID token's signature and claims", async () => {
    const jwks = async () => ({ keys: [jwk] });
    const good = idToken({ iss: "https://auth.openai.com", aud: "oaiapp_1", exp: Date.now() / 1000 + 60, nonce: "n" });
    await expect(verifyIdToken(good, { clientId: "oaiapp_1", nonce: "n" }, jwks)).resolves.toMatchObject({ nonce: "n" });
    await expect(verifyIdToken(good, { clientId: "oaiapp_2", nonce: "n" }, jwks)).rejects.toThrow(/another client/);
    await expect(verifyIdToken(good, { clientId: "oaiapp_1", nonce: "x" }, jwks)).rejects.toThrow(/nonce/);
    const tampered = good.replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: "oaiapp_1", exp: 9e9, nonce: "n" })).toString("base64url")}.`);
    await expect(verifyIdToken(tampered, { clientId: "oaiapp_1", nonce: "n" }, jwks)).rejects.toThrow(/signature/);
  });

  it("picks the newest full-size model from the plan's catalog", () => {
    expect(pickDefaultModel(["gpt-5.4", "gpt-6.1-sol", "gpt-6.1-mini", "gpt-6-sol", "o3"])).toBe("gpt-6.1-sol");
    expect(pickDefaultModel(["o3"])).toBeNull();
  });
});

describe("DeepSeek", () => {
  it("asks for json_object with the schema in the prompt, no strict tools, no effort", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: "deepseek-chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 4 } }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const provider = deepseekProvider("sk-test", fetchImpl);
    const r = await provider.call({
      model: "deepseek-chat",
      system: [{ text: "你是记录员。" }],
      messages: [{ role: "user", content: "整理一下" }],
      maxTokens: 500,
      effort: "high",
      json: { name: "x", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
      tools: [{ name: "leave", description: "离开", schema: { type: "object", properties: {} } }],
    });
    const sent = bodies[0]!;
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.max_tokens).toBe(500);
    expect(sent.max_completion_tokens).toBeUndefined();
    expect(sent.reasoning_effort).toBeUndefined();
    expect((sent.tools as { function: { strict?: boolean } }[])[0]!.function.strict).toBeUndefined();
    expect((sent.messages as { content: string }[])[0]!.content).toMatch(/json[\s\S]*"ok"/);
    expect(r.text).toBe('{"ok":true}');
    expect(r.usage).toMatchObject({ inputTokens: 6, cacheReadTokens: 4 });
  });

  it("is used only when nothing else is configured, and needs a key in the app", () => {
    const config = loadConfig({});
    const none = { anthropic: null, openai: null, notes: [] };
    expect(resolveRoute("dialogue", config, { ...none, deepseek: { apiKey: "k" } })).toMatchObject({ ok: true, route: { provider: "deepseek", model: "deepseek-chat" } });
    expect(resolveRoute("dialogue", config, none, { dialogue: "deepseek:deepseek-reasoner" })).toMatchObject({ ok: false });
    expect(resolveRoute("dialogue", config, { ...none, chatgpt: { email: null, model: "gpt-6.1-sol" } })).toMatchObject({ ok: true, route: { provider: "chatgpt" } });
  });

  it("is saved outside the village database and picked up by the credential store", () => {
    const { accounts } = testAccounts();
    const store = new CredentialStore("/nonexistent/claude", "/nonexistent/codex", accounts);
    expect(store.get().deepseek).toBeNull();
    accounts.setDeepseekKey("sk-abc");
    expect(store.get().deepseek).toEqual({ apiKey: "sk-abc" });
    accounts.setDeepseekKey(null);
    expect(store.get().deepseek).toBeNull();
  });
});
