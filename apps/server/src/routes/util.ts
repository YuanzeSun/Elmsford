import type { Context } from "hono";
import { z } from "zod";
import type { ClockService } from "../clock";
import { LOCAL_VILLAGE_ID, type ServerConfig } from "../config";
import type { ConversationService } from "../conversation/service";
import type { Db } from "../db/client";
import type { AccountStore } from "../llm/accounts";
import type { ChatGptSession } from "../llm/chatgpt";
import type { LlmGateway } from "../llm/gateway";
import type { Simulation } from "../sim/engine";
import type { StoryTime } from "../sim/story";
import { getVillage, type Village } from "../village";

export interface Services {
  db: Db;
  clock: ClockService;
  gateway: LlmGateway;
  config: ServerConfig;
  conversations: ConversationService;
  sim: Simulation;
  story: StoryTime;
  accounts: AccountStore;
  chatgpt: ChatGptSession;
}

export async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? parsed.data : c.json({ error: parsed.error.message }, 400);
}

/** The local village, or a 409 telling the client to open a session first. */
export function village(c: Context, db: Db): Village | Response {
  return getVillage(db, LOCAL_VILLAGE_ID) ?? c.json({ error: "no village yet; POST /api/session first" }, 409);
}
