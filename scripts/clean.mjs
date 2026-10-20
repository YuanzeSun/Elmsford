#!/usr/bin/env node
// 把 Elmsford 在这台电脑上留下的东西都清掉：
//   - 村子的存档（data/，或者 .env 里 DATABASE_PATH 指的地方），局域网配对码也在那里
//   - 在设置里接上的账号（~/.config/elmsford/：ChatGPT 登录、DeepSeek 的 key）；
//     ChatGPT 的登录会先在 OpenAI 那边作废
//   - 装下的依赖（node_modules）和打包出来的文件（apps/web/dist）
//   - 自己建的 .env
// 代码本身留着。不碰 ~/.claude 和 ~/.codex：那是 Claude Code 和 Codex 自己的配置。
//
//   pnpm clean          列出要删的，问一句再删
//   pnpm clean --yes    不问
//
// 只用 Node 自带的东西，依赖删了也能跑。

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { connect } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const yes = process.argv.includes("--yes") || process.argv.includes("-y");

// The same overrides the server reads.
const envFile = join(ROOT, ".env");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
const nonEmpty = (v) => (v && v.trim() ? v.trim() : undefined);

const dbPath = nonEmpty(env.DATABASE_PATH) ?? "data/elmsford.sqlite";
const dbFile = isAbsolute(dbPath) ? dbPath : resolve(ROOT, dbPath);
const accountsDir = nonEmpty(env.ELMSFORD_CONFIG_DIR) ?? join(nonEmpty(env.XDG_CONFIG_HOME) ?? join(homedir(), ".config"), "elmsford");
const port = Number(nonEmpty(env.PORT) ?? 8787);

/** What there is to remove, each with what it is. */
const targets = [];
const add = (path, what) => existsSync(path) && targets.push({ path, what });

// The save: the whole data/ folder when it's the default one; otherwise only the files the server wrote.
const defaultData = join(ROOT, "data");
if (dirname(dbFile) === defaultData) add(defaultData, "村子的存档和局域网配对码");
else {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) add(dbFile + suffix, "村子的存档");
  add(join(dirname(dbFile), "pairing-token"), "局域网配对码");
}
add(accountsDir, "在设置里接上的账号（ChatGPT 登录、DeepSeek 的 key）");
add(envFile, "自己建的 .env");
add(join(ROOT, "apps", "web", "dist"), "打包出来的网页");
add(join(ROOT, "node_modules"), "装下的依赖");
for (const group of ["apps", "packages"]) {
  const dir = join(ROOT, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) add(join(dir, name, "node_modules"), "装下的依赖");
}

/** Whether something is listening on a local port (the game still running). */
function listening(p) {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port: p });
    socket.setTimeout(500);
    socket.once("connect", () => (socket.destroy(), done(true)));
    socket.once("error", () => done(false));
    socket.once("timeout", () => (socket.destroy(), done(false)));
  });
}

/** Sign out of ChatGPT on OpenAI's side, the way 设置 → 退出 does. Best effort. */
async function revokeChatGpt() {
  const file = join(accountsDir, "chatgpt.json");
  if (!existsSync(file)) return null;
  let record;
  try {
    record = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!record?.tokens?.refresh || !record.clientId) return null;
  try {
    const res = await fetch("https://auth.openai.com/api/accounts/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: record.tokens.refresh, token_type_hint: "refresh_token", client_id: record.clientId }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const shown = (p) => (p.startsWith(ROOT + "/") ? p.slice(ROOT.length + 1) : p.replace(homedir(), "~"));

if (!targets.length) {
  console.log("没什么要清的。");
  process.exit(0);
}

if ((await listening(port)) || (await listening(5173))) {
  console.log("Elmsford 还开着。先在它的终端里按 Ctrl-C 停掉，再清理。");
  process.exit(1);
}

console.log("要删掉这些：\n");
for (const t of targets) console.log(`  ${shown(t.path).padEnd(36)} ${t.what}`);
console.log("\n不会碰 ~/.claude 和 ~/.codex。删了就找不回来。");

if (!yes) {
  if (!process.stdin.isTTY) {
    console.log("要删就加上 --yes 再运行一次。");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("\n删吗？(y/N) ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    console.log("没删。");
    process.exit(0);
  }
}

const revoked = await revokeChatGpt();
if (revoked === false) console.log("没联系上 OpenAI。ChatGPT 的登录要等它自己过期才失效（最多一个月左右），也可以在 ChatGPT 的账号设置里手动撤销。");

for (const t of targets) {
  try {
    rmSync(t.path, { recursive: true, force: true });
  } catch (err) {
    console.log(`  删不掉 ${shown(t.path)}：${err.message}`);
  }
}
const left = targets.filter((t) => existsSync(t.path));
console.log(left.length ? "\n有些没删掉，见上面。" : "\n清干净了。");
console.log("浏览器里还记着声音、音量和通知的开关；要清的话，在浏览器的网站设置里删掉 127.0.0.1 的数据。");
console.log(`代码还在 ${ROOT.replace(homedir(), "~")}，不要了直接删掉这个文件夹就行。`);
