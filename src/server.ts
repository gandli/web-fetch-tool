import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";
import { createDb } from "./db/index.ts";

/**
 * Local development server (Bun). The app itself is runtime-neutral: `handle`
 * takes a web Request and returns a web Response.
 */
const config = loadConfig();
const db = await createDb(config);
const app = createApp({ config, db });

const server = Bun.serve({
  port: config.port,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(request) {
    return app.handle(request);
  },
});

console.log(`web-fetch-tool listening on http://127.0.0.1:${server.port}`);
console.log(`docs:  http://127.0.0.1:${server.port}/api/docs`);
console.log(`db:    ${config.dbDriver}${config.dbDriver === "pglite" ? ` (${config.pglitePath})` : ""}`);
console.log(`auth:  ${config.apiAuthRequired ? "required" : "disabled"}`);

async function shutdown(signal: string) {
  console.log(`\n[server] ${signal}, shutting down`);
  await app.drainBackground().catch(() => {});
  await server.stop();
  await db.close().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
