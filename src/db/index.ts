import type { AppConfig } from "../config.ts";
import type { Db } from "./db.ts";
import { PgliteDb } from "./pglite.ts";
import { PgDb } from "./pg.ts";

export * from "./db.ts";
export { migrate } from "./migrate.ts";
export {
  fetchRepo,
  aiRepo,
  archiveRepo,
  tokenRepo,
  telegramRepo,
  settingsRepo,
  rateLimitRepo,
  DEFAULT_TELEGRAM_SETTINGS,
  type FetchRow,
  type AiRow,
  type ArchiveRow,
  type TokenRow,
  type TelegramBindingRow,
  type TelegramSettings,
} from "./repositories.ts";

export async function createDb(config: AppConfig): Promise<Db> {
  if (config.dbDriver === "pg") {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is required when DB_DRIVER=pg");
    return new PgDb(config.databaseUrl);
  }
  return new PgliteDb(config.pglitePath);
}
