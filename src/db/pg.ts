import pg from "pg";
import type { Db } from "./db.ts";

/** Real Postgres (docker compose) for parity checks and larger local datasets. */
export class PgDb implements Db {
  readonly kind = "pg" as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params as never[]);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
