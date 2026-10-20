import { Hono } from "hono";
import { z } from "zod";
import { LOCAL_VILLAGE_ID } from "../config";
import { deepseekProvider } from "../llm/providers";
import { EFFORTS, TIERS } from "../llm/types";
import { body, type Services } from "./util";

const EffortBody = z.object({
  tier: z.enum(TIERS),
  /** null goes back to each call's own level. */
  effort: z.enum(EFFORTS).nullable(),
});

const SelectionBody = z.object({
  tier: z.enum(TIERS),
  /** "anthropic:<model>" or "openai:<model>"; null goes back to automatic. */
  spec: z.string().regex(/^(anthropic|openai):\S+$/).nullable(),
});

const KeyBody = z.object({ key: z.string().trim().min(8).max(400) });
const StartBody = z.object({ returnTo: z.string().url() });

/** Only back to a page of this app on this machine. */
function loopback(url: string): boolean {
  const u = new URL(url);
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
}

/**
 * Model settings: where credentials came from, what the endpoints offer, which model serves
 * each tier. Available in production too, but only from this machine (see lan.ts).
 */
export function settingsRoutes(s: Services) {
  const { gateway, accounts, chatgpt } = s;
  const r = new Hono();

  // ---- accounts connected in the app ----

  const accountsView = () => {
    const rec = chatgpt.record();
    return {
      chatgpt: { signedIn: Boolean(rec.tokens), canUsePlan: rec.canUsePlan, name: rec.name, email: rec.email },
      deepseek: { connected: Boolean(accounts.deepseekKey()) },
    };
  };

  r.get("/accounts", (c) => c.json(accountsView()));

  r.post("/deepseek", async (c) => {
    const b = await body(c, KeyBody);
    if (b instanceof Response) return b;
    // Keep only a key that works.
    try {
      await deepseekProvider(b.key).listModels();
    } catch (err) {
      console.error("DeepSeek key check failed:", err instanceof Error ? err.message : err);
      return c.json({ error: "接不上" }, 400);
    }
    accounts.setDeepseekKey(b.key);
    return c.json(accountsView());
  });

  r.delete("/deepseek", (c) => {
    accounts.setDeepseekKey(null);
    return c.json(accountsView());
  });

  r.post("/chatgpt/start", async (c) => {
    const b = await body(c, StartBody);
    if (b instanceof Response) return b;
    if (!loopback(b.returnTo)) return c.json({ error: "bad returnTo" }, 400);
    return c.json({ url: chatgpt.start(b.returnTo) });
  });

  r.post("/chatgpt/signout", async (c) => {
    await chatgpt.signOut();
    return c.json(accountsView());
  });

  r.get("/llm", async (c) => c.json(await gateway.status(LOCAL_VILLAGE_ID)));

  r.get("/llm/models", async (c) => c.json(await gateway.listModels(c.req.query("refresh") === "1")));

  r.post("/llm/selection", async (c) => {
    const b = await body(c, SelectionBody);
    if (b instanceof Response) return b;
    gateway.setSelection(b.tier, b.spec);
    return c.json(await gateway.status(LOCAL_VILLAGE_ID));
  });

  r.post("/llm/effort", async (c) => {
    const b = await body(c, EffortBody);
    if (b instanceof Response) return b;
    gateway.setEffort(b.tier, b.effort);
    return c.json(await gateway.status(LOCAL_VILLAGE_ID));
  });

  return r;
}
