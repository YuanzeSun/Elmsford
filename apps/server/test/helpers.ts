import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClockService } from "../src/clock";
import { ConversationService } from "../src/conversation/service";
import type { Db } from "../src/db/client";
import { AccountStore } from "../src/llm/accounts";
import { ChatGptSession } from "../src/llm/chatgpt";
import type { LlmGateway } from "../src/llm/gateway";
import { Simulation } from "../src/sim/engine";
import { StoryTime } from "../src/sim/story";

/** Accounts in a throwaway folder, never the real ~/.config/elmsford. */
export function testAccounts(http?: typeof fetch) {
  const accounts = new AccountStore(join(mkdtempSync(join(tmpdir(), "elmsford-accounts-")), "elmsford"));
  const chatgpt = new ChatGptSession(accounts, "http://127.0.0.1:8787/auth/callback", http);
  return { accounts, chatgpt };
}

/** The simulation, story clock and conversations, wired the way the server wires them. */
export function testServices(db: Db, clock: ClockService, gateway: LlmGateway) {
  const sim = new Simulation(db, clock, gateway);
  const story = new StoryTime(db, clock, (id) => void sim.advance(id).catch(() => {}));
  const conversations = new ConversationService(db, clock, gateway, story);
  return { sim, story, conversations };
}
