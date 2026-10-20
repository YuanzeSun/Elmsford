import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { ClockService } from "./clock";
import { loadConfig } from "./config";
import { openDb } from "./db/client";
import { AccountStore } from "./llm/accounts";
import { ChatGptSession } from "./llm/chatgpt";
import { CredentialStore, describeCredentials } from "./llm/credentials";
import { ConversationService } from "./conversation/service";
import { LlmGateway } from "./llm/gateway";
import { LOCAL_VILLAGE_ID } from "./config";
import { lanAddresses, pairingToken } from "./lan";
import { Simulation } from "./sim/engine";
import { StoryTime } from "./sim/story";
import { getVillage } from "./village";

const config = loadConfig();
const db = openDb(config.databasePath);
const clock = new ClockService(db, config.devMode);
const accounts = new AccountStore(config.accountsDir);
const chatgpt = new ChatGptSession(accounts, `http://127.0.0.1:${config.port}/auth/callback`);
const credentials = new CredentialStore(config.claudeConfigDir, config.codexHome, accounts);
const gateway = new LlmGateway({ db, clock, config, credentials, chatgpt });
const sim = new Simulation(db, clock, gateway);
// Story mode: whenever the player's doings move the village's clock, the village catches up.
const story = new StoryTime(db, clock, (id) => void sim.advance(id).catch((err: unknown) => console.error("sim failed:", err)));
const conversations = new ConversationService(db, clock, gateway, story);
conversations.resume();
const token = config.lan ? pairingToken(config.databasePath) : undefined;
const app = createApp({ db, clock, gateway, config, conversations, sim, story, accounts, chatgpt }, token ? { pairingToken: token } : {});

// Background upkeep: keep the village's clock moving, end idle conversations, retry extractions.
// The village lives whether or not anyone is looking (设定圣经 §5.8).
const tick = () => {
  if (!getVillage(db, LOCAL_VILLAGE_ID)) return;
  void sim.advance(LOCAL_VILLAGE_ID).catch((err: unknown) => console.error("sim failed:", err));
  void conversations.sweep(LOCAL_VILLAGE_ID).catch((err: unknown) => console.error("sweep failed:", err));
};
setInterval(tick, 30_000).unref();

// Localhost only: this process holds the user's own CLI credentials.
serve({ fetch: app.fetch, port: config.port, hostname: config.host }, ({ port }) => {
  const creds = describeCredentials(credentials.get());
  console.log(`Elmsford server on http://127.0.0.1:${port}${config.devMode ? "  [dev mode]" : ""}`);
  if (token) {
    console.log(`  局域网模式：同一个 Wi-Fi 下的手机打开下面的链接（链接里带着配对码，别发给别人）：`);
    for (const ip of lanAddresses()) console.log(`    http://${ip}:${port}/?pair=${token}`);
  }
  console.log(`  Claude: ${creds.anthropic ? `${creds.anthropic.file} → ${creds.anthropic.baseURL}` : "未读到"}`);
  console.log(`  Codex:  ${creds.openai ? `${creds.openai.files.join(" + ")} → ${creds.openai.baseURL} (${creds.openai.wireApi})` : "未读到"}`);
  for (const note of creds.notes) console.log(`  · ${note}`);
});
