import type { ServerConfig } from "../config";
import type { DiscoveredCredentials } from "./credentials";
import type { ProviderId, Tier } from "./types";

export interface ModelRoute {
  tier: Tier;
  provider: ProviderId;
  model: string;
  /** Where the model ID came from, for the dev panel. */
  from: string;
}

export type RouteResult = { ok: true; route: ModelRoute } | { ok: false; reason: string };

const PREFIX: Record<string, ProviderId> = { anthropic: "anthropic", claude: "anthropic", openai: "openai", codex: "openai", chatgpt: "chatgpt", deepseek: "deepseek" };
const LABEL: Record<ProviderId, string> = { anthropic: "Claude Code", openai: "Codex", chatgpt: "ChatGPT 登录", deepseek: "DeepSeek" };
const DEEPSEEK_DEFAULT = "deepseek-chat";

/** "anthropic:x" / "openai:x" / "chatgpt:x" / "deepseek:x", or a bare ID guessed by its name. */
export function parseModelSpec(spec: string): { provider: ProviderId; model: string } {
  const match = /^(anthropic|openai|claude|codex|chatgpt|deepseek):(.+)$/.exec(spec);
  if (match) return { provider: PREFIX[match[1]!]!, model: match[2]!.trim() };
  return { provider: spec.startsWith("claude") ? "anthropic" : spec.startsWith("deepseek") ? "deepseek" : "openai", model: spec };
}

export function hasProvider(creds: DiscoveredCredentials, provider: ProviderId): boolean {
  return Boolean(provider === "anthropic" ? creds.anthropic : provider === "openai" ? creds.openai : provider === "chatgpt" ? creds.chatgpt : creds.deepseek);
}

export type ModelSelection = Partial<Record<Tier, string>>;

/**
 * Which provider and model serve a tier, in order of precedence:
 *   1. a choice made in settings (stored in the database),
 *   2. a MODEL_<TIER> override in the environment,
 *   3. the first available of: Claude Code's settings (or the default Claude model for the
 *      tier), Codex's configured model, a ChatGPT sign-in, a DeepSeek key — skipping one whose
 *      endpoint turned out not to answer this app (`unreachable`) when another one is there.
 */
export function resolveRoute(
  tier: Tier,
  config: ServerConfig,
  creds: DiscoveredCredentials,
  selection: ModelSelection = {},
  unreachable: ReadonlySet<ProviderId> = new Set(),
): RouteResult {
  const chosen = selection[tier];
  const override = config.modelOverrides[tier];
  const explicit = chosen ?? override;
  if (explicit) {
    const { provider, model } = parseModelSpec(explicit);
    const from = chosen ? "手动选择" : `MODEL_${tier.toUpperCase()}`;
    if (!hasProvider(creds, provider)) return { ok: false, reason: `${from}的 ${explicit} 需要 ${LABEL[provider]}，但没接上` };
    return { ok: true, route: { tier, provider, model, from } };
  }

  const named = creds.anthropic?.models[tier];
  const candidates: ModelRoute[] = [
    ...(creds.anthropic ? [{ tier, provider: "anthropic" as const, model: named ?? config.defaultClaudeModels[tier], from: named ? creds.anthropic.file : "默认" }] : []),
    ...(creds.openai?.model ? [{ tier, provider: "openai" as const, model: creds.openai.model, from: creds.openai.files[0] ?? "Codex" }] : []),
    ...(creds.chatgpt?.model ? [{ tier, provider: "chatgpt" as const, model: creds.chatgpt.model, from: "ChatGPT" }] : []),
    ...(creds.deepseek ? [{ tier, provider: "deepseek" as const, model: DEEPSEEK_DEFAULT, from: "DeepSeek" }] : []),
  ];
  const route = candidates.find((c) => !unreachable.has(c.provider)) ?? candidates[0];
  if (route) return { ok: true, route };
  if (creds.openai) return { ok: false, reason: "Codex 配置里没有 model，请在设置里选一个" };
  return { ok: false, reason: ["没有可用的模型", ...creds.notes].join("；") };
}
