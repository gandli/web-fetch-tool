import pg from "pg";
import { loadConfig } from "../src/config.ts";
import { migrate } from "../src/db/migrate.ts";
import { PgDb } from "../src/db/pg.ts";

/**
 * RLS parity check against a real Postgres (docker compose up -d db).
 * Verifies that anonymous users can read/write shared history and cannot touch
 * tokens, bindings or sessions.
 */
const config = loadConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL is required (or run: docker compose up -d db)");
  process.exit(1);
}

const db = new PgDb(config.databaseUrl);
const result = await migrate(db, `${import.meta.dir}/../migrations`);
console.log(`migrations applied: ${result.applied.join(", ") || "(none)"}`);

const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();

async function run(label: string, sql: string): Promise<void> {
  try {
    await client.query(sql);
    console.log(`  ok    ${label}`);
  } catch (error) {
    console.log(`  deny  ${label} -> ${(error as { code?: string }).code ?? (error as Error).message}`);
  }
}

console.log("== as anon");
await client.query("set role anon");
await run("select fetch_history", "select count(*) from fetch_history");
await run("insert fetch_history", `insert into fetch_history (id, url, normalized_url, platform, provider, status) values (gen_random_uuid(), 'https://rls.test', 'https://rls.test', 'web', 'self', 'ok')`);
await run("select api_tokens", "select count(*) from api_tokens");
await run("select telegram_bindings", "select count(*) from telegram_bindings");
await run("select platform_sessions", "select count(*) from platform_sessions");
await client.query("reset role");

console.log("== as authenticated");
await client.query("set role authenticated");
await run("select ai_results", "select count(*) from ai_results");
await run("update fetch_history", "update fetch_history set title = 'x' where url = 'https://rls.test'");
await client.query("reset role");

await client.end();
await db.close();
