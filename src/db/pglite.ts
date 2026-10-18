import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./db.ts";

/** Zero-setup embedded Postgres. SQL, roles and RLS behave like the real thing. */
export class PgliteDb implements Db {
  readonly kind = "pglite" as const;
  private readonly client: PGlite;

  constructor(path?: string) {
    if (path) {
      const absolute = resolve(path);
      mkdirSync(dirname(absolute), { recursive: true });
      this.client = new PGlite(absolute);
    } else {
      this.client = new PGlite();
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query<T>(sql, params as never[]);
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.client.exec(sql);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
