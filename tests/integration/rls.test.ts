import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PgliteDb } from "../../src/db/pglite.ts";
import { migrate } from "../../src/db/migrate.ts";
import { fetchRepo, rateLimitRepo } from "../../src/db/repositories.ts";
import { MIGRATIONS } from "../helpers/app.ts";

async function insertSample(db: PgliteDb): Promise<string> {
  const row = await fetchRepo.insert(db, {
    id: randomUUID(),
    url: "https://example.com/rls",
    normalizedUrl: "https://example.com/rls",
    platform: "web",
    engine: "auto",
    provider: "self",
    title: "RLS sample",
    contentMarkdown: "body",
    contentLength: 4,
    rawHtml: null,
    metadata: {},
    og: {},
    usage: {},
    metrics: {},
    status: "ok",
    errorCode: null,
    fetchAttempts: [],
    extractDebug: {},
  });
  return row.id;
}

describe("row level security", () => {
  test("anonymous users can read and write shared history", async () => {
    const db = new PgliteDb();
    await migrate(db, MIGRATIONS);
    await insertSample(db);

    await db.exec("set role anon");
    const rows = await db.query<{ count: number }>("select count(*)::int as count from fetch_history");
    expect(rows[0]!.count).toBe(1);

    const inserted = await db.query<{ id: string }>(
      `insert into fetch_history (id, url, normalized_url, platform, provider, status)
       values (gen_random_uuid(), 'https://anon.test', 'https://anon.test', 'web', 'self', 'ok') returning id`,
    );
    expect(inserted).toHaveLength(1);

    const updated = await db.query<{ title: string }>(
      "update fetch_history set title = 'changed' where url = 'https://anon.test' returning title",
    );
    expect(updated[0]!.title).toBe("changed");
    await db.exec("reset role");
    await db.close();
  });

  test("anonymous users cannot touch tokens, bindings or sessions", async () => {
    const db = new PgliteDb();
    await migrate(db, MIGRATIONS);
    await db.exec("set role anon");

    for (const table of ["api_tokens", "telegram_bindings", "telegram_logs", "platform_sessions", "app_settings", "rate_limit_counters"]) {
      await expect(db.query(`select count(*) from ${table}`)).rejects.toThrow();
    }
    await db.exec("reset role");
    await db.close();
  });

  test("authenticated role shares the public history policies", async () => {
    const db = new PgliteDb();
    await migrate(db, MIGRATIONS);
    await insertSample(db);
    await db.exec("set role authenticated");
    const rows = await db.query<{ count: number }>("select count(*)::int as count from ai_results");
    expect(rows[0]!.count).toBe(0);
    await db.exec("reset role");
    await db.close();
  });

  test("rate limit windows are atomic and reset", async () => {
    const db = new PgliteDb();
    await migrate(db, MIGRATIONS);

    const first = await rateLimitRepo.bump(db, "test:key", 2, 60);
    expect(first.allowed).toBe(true);
    expect(first.count).toBe(1);

    const second = await rateLimitRepo.bump(db, "test:key", 2, 60);
    expect(second.allowed).toBe(true);

    const third = await rateLimitRepo.bump(db, "test:key", 2, 60);
    expect(third.allowed).toBe(false);
    expect(third.count).toBe(3);

    const shortWindow = await rateLimitRepo.bump(db, "test:reset", 1, 1);
    expect(shortWindow.allowed).toBe(true);
    await db.query("select pg_sleep(1.1)");
    const afterReset = await rateLimitRepo.bump(db, "test:reset", 1, 1);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.count).toBe(1);

    await db.close();
  });
});
