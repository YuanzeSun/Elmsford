export type Tier = "dialogue" | "planner" | "cheap";
export const TIERS: readonly Tier[] = ["dialogue", "planner", "cheap"];

/** anthropic and openai come from the Claude Code and Codex configs; chatgpt and deepseek are connected in the app. */
export type ProviderId = "anthropic" | "openai" | "chatgpt" | "deepseek";
export const PROVIDERS: readonly ProviderId[] = ["anthropic", "openai", "chatgpt", "deepseek"];
export type Effort = "low" | "medium" | "high" | "xhigh";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh"];

export interface SystemBlock {
  text: string;
  /** Mark the end of a stable prefix for prompt caching. */
  cache?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface JsonSpec {
  name: string;
  schema: Record<string, unknown>;
}

/** A side action the model may take while answering (e.g. hand something over, leave). */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the input; every property required, nullable when optional. */
  schema: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  /** Parsed JSON input — unvalidated; callers check it against their own schema. */
  input: unknown;
}

export interface Usage {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ProviderCall {
  model: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  maxTokens: number;
  effort?: Effort;
  json?: JsonSpec;
  tools?: ToolSpec[];
  /** Groups calls that share a prompt prefix, so the provider can route them to the same cache. */
  cacheKey?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** When set, the call streams and this receives each text delta. */
  onText?: (delta: string) => void;
}

export interface ProviderResult {
  text: string;
  toolCalls: ToolCall[];
  /** Model that actually answered (may differ after a server-side fallback). */
  model: string;
  usage: Usage;
  stopReason: string;
  refused: boolean;
}

export interface Provider {
  call(call: ProviderCall): Promise<ProviderResult>;
  /** Model IDs this endpoint offers (a relay may offer fewer than the first-party API). */
  listModels(): Promise<string[]>;
}
