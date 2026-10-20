import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { lanGuard } from "./lan";
import { devRoutes } from "./routes/dev";
import { playerRoutes } from "./routes/player";
import { settingsRoutes } from "./routes/settings";
import type { Services } from "./routes/util";

export type { Services as AppDeps } from "./routes/util";

export function createApp(services: Services, opts: { pairingToken?: string } = {}) {
  const app = new Hono();
  if (services.config.lan && opts.pairingToken) app.use("*", lanGuard(opts.pairingToken));
  app.route("/api/settings", settingsRoutes(services));
  // Sign in with ChatGPT comes back here (an HTTP loopback on 127.0.0.1, path /auth/callback).
  app.get("/auth/callback", async (c) => {
    const { returnTo, outcome } = await services.chatgpt.finish(new URL(c.req.url).searchParams);
    const back = new URL(returnTo, "http://127.0.0.1");
    back.searchParams.set("chatgpt", outcome);
    return c.redirect(back.toString());
  });
  app.route("/api", playerRoutes(services));
  // Dev tools don't exist at all outside dev mode.
  const dev = new Hono();
  dev.use("*", async (c, next) => (services.config.devMode ? next() : c.notFound()));
  dev.route("/", devRoutes(services));
  app.route("/api/dev", dev);

  // The built client, when there is one (pnpm build). In development Vite serves it instead.
  const dist = services.config.webDist;
  if (existsSync(dist)) {
    app.use("/*", serveStatic({ root: dist }));
    // Client-side routes (/dev) fall back to the app shell.
    app.get("*", serveStatic({ root: dist, rewriteRequestPath: () => "/index.html" }));
  }
  return app;
}
