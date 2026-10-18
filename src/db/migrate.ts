import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./db.ts";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Tiny forward-only migrator. Each file runs inside a transaction, so a broken
 * migration leaves the database untouched.
 */
export async function migrate(db: Db, directory: string): Promise<MigrationResult> {
  await db.exec(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());",
  );
  const files = (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort();
  const rows = await db.query<{ name: string }>("select name from schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = await readFile(join(directory, file), "utf8");
    await db.exec(`begin;\n${sql}\ncommit;`);
    await db.query("insert into schema_migrations (name) values ($1)", [file]);
    applied.push(file);
  }

  return { applied, skipped };
}
