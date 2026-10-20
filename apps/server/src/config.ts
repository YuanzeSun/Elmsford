import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tier } from "./llm/types";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The single local village until accounts arrive in M6. */
export const LOCAL_VILLAGE_ID = "local";

export interface ServerConfig {
  port: number;
  host: string;
  /** Opt-in: listen on the local network so a phone can join, behind a pairing token. */
  lan: boolean;
  /** Built client to serve (apps/web/dist), if it exists. */
  webDist: string;
  databasePath: string;
  devMode: boolean;
  /** Where Claude Code and Codex keep their settings; credentials are read from here, nowhere else. */
  claudeConfigDir: string;
  codexHome: string;
  /** Accounts connected in the app itself (DeepSeek key, ChatGPT sign-in). */
  accountsDir: string;
  /** Optional per-tier override: "anthropic:<model>", "openai:<model>", or a bare model ID. */
  modelOverrides: Partial<Record<Tier, string>>;
  /** Claude models used when ~/.claude/settings.json doesn't name one for the tier. */
  defaultClaudeModels: Record<Tier, string>;
  /** Server-side refusal fallback (beta). "auto" enables it only against api.anthropic.com. */
  refusalFallback: "auto" | "on" | "off";
  villageDailyBudgetUsd: number;
  globalDailyCapUsd: number;
}

function number(value: string | undefined, fallback: number): number {
  const n = value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  // Optional, non-secret overrides only. API keys are never read from here.
  const envFile = join(REPO_ROOT, ".env");
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const dbPath = nonEmpty(env.DATABASE_PATH) ?? "data/elmsford.sqlite";
  const fallback = env.LLM_REFUSAL_FALLBACK;

  const lan = env.ELMSFORD_LAN === "1";
  return {
    port: number(env.PORT, 8787),
    host: lan ? "0.0.0.0" : "127.0.0.1",
    lan,
    webDist: join(REPO_ROOT, "apps/web/dist"),
    databasePath: isAbsolute(dbPath) ? dbPath : resolve(REPO_ROOT, dbPath),
    devMode: env.DEV_MODE === "1",
    claudeConfigDir: nonEmpty(env.CLAUDE_CONFIG_DIR) ?? join(homedir(), ".claude"),
    codexHome: nonEmpty(env.CODEX_HOME) ?? join(homedir(), ".codex"),
    accountsDir: nonEmpty(env.ELMSFORD_CONFIG_DIR) ?? join(nonEmpty(env.XDG_CONFIG_HOME) ?? join(homedir(), ".config"), "elmsford"),
    modelOverrides: {
      ...(nonEmpty(env.MODEL_DIALOGUE) ? { dialogue: nonEmpty(env.MODEL_DIALOGUE) } : {}),
      ...(nonEmpty(env.MODEL_PLANNER) ? { planner: nonEmpty(env.MODEL_PLANNER) } : {}),
      ...(nonEmpty(env.MODEL_CHEAP) ? { cheap: nonEmpty(env.MODEL_CHEAP) } : {}),
    },
    defaultClaudeModels: {
      dialogue: "claude-opus-5-5",
      planner: "claude-sonnet-5-5",
      cheap: "claude-haiku-5-5",
    },
    refusalFallback: fallback === "on" || fallback === "off" ? fallback : "auto",
    villageDailyBudgetUsd: number(env.LLM_VILLAGE_DAILY_BUDGET_USD, 1),
    globalDailyCapUsd: number(env.LLM_GLOBAL_DAILY_CAP_USD, 5),
  };
}
