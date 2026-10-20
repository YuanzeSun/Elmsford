// LAN mode (M6): the same village on your phone. The server holds your CLI credentials, so
// anything that isn't this machine must present a pairing token, and the dev tools (which
// show prompts and logs) stay loopback-only no matter what.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const COOKIE = "elmsford_pair";

export function pairingToken(databasePath: string): string {
  const file = join(dirname(databasePath), "pairing-token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const token = randomBytes(18).toString("base64url");
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a): a is NonNullable<typeof a> => Boolean(a && a.family === "IPv4" && !a.internal))
    .map((a) => a.address);
}

const isLoopback = (addr: string | undefined) => !addr || addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

export function lanGuard(token: string): MiddlewareHandler {
  return async (c, next) => {
    let remote: string | undefined;
    try {
      remote = getConnInfo(c).remote.address;
    } catch {
      remote = "unknown";
    }
    if (isLoopback(remote)) return next();
    // Dev tools and model settings stay on this machine.
    if (c.req.path.startsWith("/api/dev") || c.req.path.startsWith("/api/settings")) return c.notFound();

    const offered = c.req.query("pair");
    if (offered === token) {
      setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", maxAge: 400 * 86_400, path: "/" });
      const url = new URL(c.req.url);
      url.searchParams.delete("pair");
      return c.redirect(url.pathname + url.search);
    }
    if (getCookie(c, COOKIE) === token) return next();
    return c.text("需要配对链接。", 401);
  };
}
