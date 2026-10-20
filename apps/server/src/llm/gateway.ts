// The one door to the LLMs (技术设计 §2, §8): picks provider and model per tier, enforces the
// daily budgets, and logs every call — prompt, output, tokens, cost, latency — to llm_calls.

import { randomUUID } from "node:crypto";
import { calendar } from "@elmsford/content";
import { computeGameTime, type Clock } from "@elmsford/core";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { ServerConfig } from "../config";
import type { Db } from "../db/client";
import { llmCalls, meta } from "../db/schema";
import { getVillage } from "../village";
import { createAnthropicProvider } from "./anthropicProvider";
import { describeCredentials, type CredentialStore, type DiscoveredCredentials } from "./credentials";
import { createOpenAIProvider } from "./openaiProvider";
import { estimateCostUsd, priceKnown } from "./pricing";
import type { ChatGptSession } from "./chatgpt";
import { chatgptProvider, deepseekProvider } from "./providers";
import { hasProvider, resolveRoute, type ModelSelection } from "./routes";
import {
  PROVIDERS,
  TIERS,
  type ChatMessage,
  type Effort,
  type JsonSpec,
  type Provider,
  type ProviderId,
  type ProviderResult,
  type SystemBlock,
  type Tier,
  type ToolCall,
  type ToolSpec,
  type Usage,
} from "./types";

export interface LlmRequest {
  tier: Tier;
  /** Short machine label, e.g. "dev.style_judge", "dialogue.hubert". */
  purpose: string;
  villageId?: string;
  /** Stable blocks first; mark the last stable one with cache: true. */
  system: SystemBlock[];
  messages: ChatMessage[];
  maxTokens: number;
  effort?: Effort;
  json?: JsonSpec;
  tools?: ToolSpec[];
  /** Calls sharing a prompt prefix (e.g. one resident's dialogue) should share a key. */
  cacheKey?: string;
  /**
   * Background simulation rather than something the player is waiting on. Background work
   * stops at twice the village budget (callers fall back to rules); talking to the player
   * continues, on the cheap tier, until the global cap.
   */
  background?: boolean;
  onText?: (delta: string) => void;
}

export interface LlmResult {
  callId: string;
  text: string;
  toolCalls: ToolCall[];
  provider: ProviderId;
  model: string;
  tierUsed: Tier;
  /** True when the village was over budget and the call was moved to the cheap tier. */
  degraded: boolean;
  refused: boolean;
  usage: Usage;
  costUsd: number;
  durationMs: number;
}

export class LlmError extends Error {
  constructor(
    readonly kind: "unavailable" | "over_budget" | "refused" | "provider",
    message: string,
    readonly callId?: string,
  ) {
    super(message);
  }
}

export type ProviderFactory = (provider: ProviderId, creds: DiscoveredCredentials) => Provider;

export type ModelList = { ok: true; models: string[]; fetchedAt: number } | { ok: false; error: string };
export type ModelCatalog = Record<ProviderId, ModelList | null>;

export interface GatewayDeps {
  db: Db;
  clock: Clock;
  config: ServerConfig;
  credentials: Pick<CredentialStore, "get">;
  /** For a ChatGPT sign-in's refreshing tokens. */
  chatgpt?: ChatGptSession;
  /** Tests inject fakes here. */
  providerFactory?: ProviderFactory;
}

const SELECTION_KEY = "model_selection";
const EFFORT_KEY = "effort_selection";
const CATALOG_TTL_MS = 10 * 60_000;
/** Simultaneous calls in flight; relays rate-limit, and catch-up can fan out. */
const MAX_CONCURRENT_CALLS = 3;
const CALL_TIMEOUT_MS = 120_000;

/** A tiny FIFO semaphore. */
class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const defaultFactory =
  (config: ServerConfig, chatgpt: ChatGptSession | undefined): ProviderFactory =>
  (provider, creds) => {
    if (provider === "anthropic") return createAnthropicProvider(creds.anthropic!, config.refusalFallback);
    if (provider === "openai") return createOpenAIProvider(creds.openai!);
    if (provider === "deepseek") return deepseekProvider(creds.deepseek!.apiKey);
    if (!chatgpt) throw new Error("ChatGPT sign-in is not set up");
    return chatgptProvider(chatgpt);
  };

/** zod → a JSON Schema both providers' structured-output modes accept. */
export function toWireSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (typeof node !== "object" || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema" || k === "minimum" || k === "maximum" || k === "exclusiveMinimum" || k === "exclusiveMaximum") continue;
      out[k] = strip(v);
    }
    return out;
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

/** Older models (e.g. Haiku 4.5) reject the effort / reasoning parameter with a 400. */
function rejectsEffort(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return status === 400 && err instanceof Error && /effort|reasoning/i.test(err.message);
}

function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class LlmGateway {
  private readonly factory: ProviderFactory;
  private readonly providers = new Map<ProviderId, { creds: DiscoveredCredentials; provider: Provider }>();
  private catalog: { creds: DiscoveredCredentials; at: number; lists: ModelCatalog } | null = null;
  /** "provider:model" pairs that turned out not to accept an effort setting. */
  private readonly noEffort = new Set<string>();
  private readonly limiter = new Limiter(MAX_CONCURRENT_CALLS);
  /** Per credential set: which providers answered a tiny probe call. */
  private probe: { creds: DiscoveredCredentials; result: Promise<Set<ProviderId>> } | null = null;

  constructor(private readonly deps: GatewayDeps) {
    this.factory = deps.providerFactory ?? defaultFactory(deps.config, deps.chatgpt);
  }

  // ---- model selection (persisted, set from the dev tools) ----

  getSelection(): ModelSelection {
    const row = this.deps.db.select().from(meta).where(eq(meta.key, SELECTION_KEY)).get();
    return (row?.value as ModelSelection | undefined) ?? {};
  }

  /** `spec` is "anthropic:<model>" / "openai:<model>"; null returns the tier to automatic. */
  setSelection(tier: Tier, spec: string | null): ModelSelection {
    const next = { ...this.getSelection() };
    if (spec) next[tier] = spec;
    else delete next[tier];
    this.deps.db
      .insert(meta)
      .values({ key: SELECTION_KEY, value: next })
      .onConflictDoUpdate({ target: meta.key, set: { value: next } })
      .run();
    return next;
  }

  /** How hard each tier thinks, if chosen; otherwise each call keeps its own level. */
  getEfforts(): Partial<Record<Tier, Effort>> {
    const row = this.deps.db.select().from(meta).where(eq(meta.key, EFFORT_KEY)).get();
    return (row?.value as Partial<Record<Tier, Effort>> | undefined) ?? {};
  }

  setEffort(tier: Tier, effort: Effort | null): Partial<Record<Tier, Effort>> {
    const next = { ...this.getEfforts() };
    if (effort) next[tier] = effort;
    else delete next[tier];
    this.deps.db
      .insert(meta)
      .values({ key: EFFORT_KEY, value: next })
      .onConflictDoUpdate({ target: meta.key, set: { value: next } })
      .run();
    return next;
  }

  // ---- what the endpoints offer ----

  /** Providers are rebuilt when the CLI configs change on disk. */
  private providerFor(id: ProviderId, creds: DiscoveredCredentials): Provider | null {
    if (!hasProvider(creds, id)) return null;
    const cached = this.providers.get(id);
    if (cached && cached.creds === creds) return cached.provider;
    const provider = this.factory(id, creds);
    this.providers.set(id, { creds, provider });
    return provider;
  }

  async listModels(refresh = false): Promise<ModelCatalog> {
    const creds = this.deps.credentials.get();
    const c = this.catalog;
    if (!refresh && c && c.creds === creds && Date.now() - c.at < CATALOG_TTL_MS) return c.lists;

    const fetchList = async (id: ProviderId): Promise<ModelList | null> => {
      const provider = this.providerFor(id, creds);
      if (!provider) return null;
      try {
        return { ok: true, models: (await provider.listModels()).sort(), fetchedAt: Date.now() };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    };
    const [anthropic, openai, chatgpt, deepseek] = await Promise.all(PROVIDERS.map(fetchList));
    const lists: ModelCatalog = { anthropic: anthropic ?? null, openai: openai ?? null, chatgpt: chatgpt ?? null, deepseek: deepseek ?? null };
    this.catalog = { creds, at: Date.now(), lists };
    return lists;
  }

  /**
   * Some endpoints hold keys this app may not use (a relay that only serves the Claude Code
   * client, say). Before routing to the default provider, check once — with a one-token call —
   * that it answers; if it doesn't and the other one does, the defaults go there instead.
   * Explicit choices are never second-guessed.
   */
  private unreachable(creds: DiscoveredCredentials): Promise<Set<ProviderId>> {
    if (this.probe?.creds === creds) return this.probe.result;
    const tryOne = async (id: ProviderId, model: string | null | undefined): Promise<boolean> => {
      const provider = this.providerFor(id, creds);
      if (!provider || !model) return false;
      try {
        await provider.call({ model, system: [{ text: "回一个字。" }], messages: [{ role: "user", content: "好" }], maxTokens: 16, timeoutMs: 30_000 });
        return true;
      } catch (err) {
        console.error(`${id} endpoint did not answer the probe:`, err instanceof Error ? err.message.slice(0, 160) : err);
        return false;
      }
    };
    const result = (async () => {
      const down = new Set<ProviderId>();
      // Only worth probing when there is somewhere else to go.
      const elsewhere = Boolean(creds.openai?.model || creds.chatgpt?.model || creds.deepseek);
      if (!creds.anthropic || !elsewhere) return down;
      const cheap = creds.anthropic.models.cheap ?? this.deps.config.defaultClaudeModels.cheap;
      if (!(await tryOne("anthropic", cheap))) down.add("anthropic");
      if (down.has("anthropic") && creds.openai?.model && !(await tryOne("openai", creds.openai.model))) down.add("openai");
      return down;
    })();
    this.probe = { creds, result };
    return result;
  }

  // ---- budget ----

  private gameDate(villageId: string | undefined, gameNow: number): string | null {
    const village = villageId ? getVillage(this.deps.db, villageId) : undefined;
    return village ? computeGameTime(gameNow, village.timeZone, calendar).date : null;
  }

  private spentSince(realStart: number): number {
    const row = this.deps.db
      .select({ total: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(gte(llmCalls.startedAt, realStart))
      .get();
    return row?.total ?? 0;
  }

  private spentByVillage(villageId: string, gameDate: string): number {
    const row = this.deps.db
      .select({ total: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(and(eq(llmCalls.villageId, villageId), eq(llmCalls.gameDate, gameDate)))
      .get();
    return row?.total ?? 0;
  }

  // ---- calls ----

  async call(req: LlmRequest): Promise<LlmResult> {
    const { db, clock, config } = this.deps;
    const callId = randomUUID();
    const startedAt = Date.now();
    const gameAt = clock.now();
    const gameDate = this.gameDate(req.villageId, gameAt);
    const request = {
      system: req.system,
      messages: req.messages,
      maxTokens: req.maxTokens,
      effort: req.effort,
      json: req.json,
      tools: req.tools?.map((t) => t.name),
    };

    const log = (row: Partial<typeof llmCalls.$inferInsert> & Pick<typeof llmCalls.$inferInsert, "status" | "tierUsed">) =>
      db
        .insert(llmCalls)
        .values({
          id: callId,
          villageId: req.villageId ?? null,
          startedAt,
          gameAt,
          gameDate,
          purpose: req.purpose,
          tierRequested: req.tier,
          request,
          ...row,
        })
        .run();

    if (this.spentSince(startOfLocalDay(startedAt)) >= config.globalDailyCapUsd) {
      log({ status: "over_budget", tierUsed: req.tier, error: "global daily cap reached" });
      throw new LlmError("over_budget", `今天的 LLM 花费已达上限 $${config.globalDailyCapUsd}`, callId);
    }

    let tier = req.tier;
    let degraded = false;
    const villageSpent = req.villageId && gameDate ? this.spentByVillage(req.villageId, gameDate) : 0;
    if (req.background && villageSpent >= 2 * config.villageDailyBudgetUsd) {
      log({ status: "over_budget", tierUsed: req.tier, error: "village background budget exhausted" });
      throw new LlmError("over_budget", "本村今天的预算用完了，幕后改按规则推进", callId);
    }
    if (tier !== "cheap" && villageSpent >= config.villageDailyBudgetUsd) {
      tier = "cheap";
      degraded = true;
    }

    const creds = this.deps.credentials.get();
    const selection = this.getSelection();
    const needsDefault = !selection[tier] && !config.modelOverrides[tier];
    const resolved = resolveRoute(tier, config, creds, selection, needsDefault ? await this.unreachable(creds) : new Set());
    if (!resolved.ok) {
      log({ status: "unavailable", tierUsed: tier, error: resolved.reason });
      throw new LlmError("unavailable", resolved.reason, callId);
    }
    const { route } = resolved;
    // A chosen level for the tier that actually serves the call wins over the call's own.
    const wanted = this.getEfforts()[tier] ?? req.effort;
    request.effort = wanted;
    const provider = this.providerFor(route.provider, creds)!;

    const effortKey = `${route.provider}:${route.model}`;
    let streamed = false;
    const onText = req.onText
      ? (delta: string) => {
          streamed = true;
          req.onText!(delta);
        }
      : undefined;
    const attempt = (effort: Effort | undefined): Promise<ProviderResult> =>
      this.limiter.run(() =>
        provider.call({
          model: route.model,
          system: req.system,
          messages: req.messages,
          maxTokens: req.maxTokens,
          timeoutMs: CALL_TIMEOUT_MS,
          ...(effort ? { effort } : {}),
          ...(req.json ? { json: req.json } : {}),
          ...(req.tools?.length ? { tools: req.tools } : {}),
          ...(req.cacheKey ? { cacheKey: req.cacheKey } : {}),
          ...(onText ? { onText } : {}),
        }),
      );

    let result: ProviderResult;
    try {
      const effort = wanted && !this.noEffort.has(effortKey) ? wanted : undefined;
      try {
        result = await attempt(effort);
      } catch (err) {
        if (effort && rejectsEffort(err)) {
          this.noEffort.add(effortKey);
          result = await attempt(undefined);
        } else if (!streamed && !(err as { status?: number })?.status) {
          // A dropped connection or stream before anything reached the player: try once more.
          result = await attempt(effort);
        } else throw err;
      }
    } catch (err) {
      const message = errorMessage(err);
      log({ status: "error", tierUsed: tier, provider: route.provider, model: route.model, durationMs: Date.now() - startedAt, error: message });
      throw new LlmError("provider", message, callId);
    }

    const durationMs = Date.now() - startedAt;
    // A ChatGPT sign-in draws on the plan, not on money.
    const costUsd = route.provider === "chatgpt" ? 0 : estimateCostUsd(result.model, result.usage);
    log({
      status: result.refused ? "refused" : "ok",
      tierUsed: tier,
      provider: route.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      costUsd,
      durationMs,
      stopReason: result.stopReason,
      response: result.text,
      toolCalls: result.toolCalls,
    });

    return {
      callId,
      text: result.text,
      toolCalls: result.toolCalls,
      provider: route.provider,
      model: result.model,
      tierUsed: tier,
      degraded,
      refused: result.refused,
      usage: result.usage,
      costUsd,
      durationMs,
    };
  }

  /** Structured output: the model is constrained to the schema, and the result is validated again here. */
  async callJson<T>(req: Omit<LlmRequest, "json" | "onText">, name: string, schema: z.ZodType<T>): Promise<LlmResult & { data: T }> {
    const result = await this.call({ ...req, json: { name, schema: toWireSchema(schema) } });
    if (result.refused) throw new LlmError("refused", "模型拒绝了这次请求", result.callId);
    let data: T;
    try {
      data = schema.parse(JSON.parse(result.text));
    } catch (err) {
      throw new LlmError("provider", `结构化输出不合格：${errorMessage(err)}`, result.callId);
    }
    return { ...result, data };
  }

  async status(villageId?: string) {
    const creds = this.deps.credentials.get();
    const selection = this.getSelection();
    const down = await this.unreachable(creds);
    const now = Date.now();
    const gameDate = this.gameDate(villageId, this.deps.clock.now());
    return {
      credentials: describeCredentials(creds),
      selection,
      efforts: this.getEfforts(),
      routes: TIERS.map((tier) => {
        const r = resolveRoute(tier, this.deps.config, creds, selection, down);
        return r.ok ? { ...r.route, priceKnown: priceKnown(r.route.model) } : { tier, error: r.reason };
      }),
      budget: {
        globalTodayUsd: this.spentSince(startOfLocalDay(now)),
        globalCapUsd: this.deps.config.globalDailyCapUsd,
        villageTodayUsd: villageId && gameDate ? this.spentByVillage(villageId, gameDate) : 0,
        villageBudgetUsd: this.deps.config.villageDailyBudgetUsd,
        gameDate,
      },
    };
  }
}
