import type { Db } from "./db.ts";

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export interface FetchRow {
  id: string;
  url: string;
  normalized_url: string;
  platform: string;
  engine: string;
  provider: string;
  title: string | null;
  content_markdown: string | null;
  content_length: number;
  raw_html: string | null;
  metadata: Record<string, unknown>;
  og: Record<string, unknown>;
  usage: Record<string, unknown>;
  metrics: Record<string, unknown>;
  status: string;
  error_code: string | null;
  fetch_attempts: unknown[];
  extract_debug: Record<string, unknown>;
  created_at: string;
}

export interface InsertFetchInput {
  id: string;
  url: string;
  normalizedUrl: string;
  platform: string;
  engine: string;
  provider: string;
  title: string | null;
  contentMarkdown: string | null;
  contentLength: number;
  rawHtml: string | null;
  metadata: unknown;
  og: unknown;
  usage: unknown;
  metrics: unknown;
  status: string;
  errorCode: string | null;
  fetchAttempts: unknown[];
  extractDebug: unknown;
}

interface RawFetchRow extends Omit<FetchRow, "created_at"> {
  created_at: Date | string;
}

function mapFetch(row: RawFetchRow): FetchRow {
  return { ...row, created_at: iso(row.created_at) ?? new Date(0).toISOString() };
}

export const fetchRepo = {
  async insert(db: Db, input: InsertFetchInput): Promise<FetchRow> {
    const rows = await db.query<RawFetchRow>(
      `insert into fetch_history
        (id, url, normalized_url, platform, engine, provider, title, content_markdown, content_length,
         raw_html, metadata, og, usage, metrics, status, error_code, fetch_attempts, extract_debug)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb)
       returning *`,
      [
        input.id,
        input.url,
        input.normalizedUrl,
        input.platform,
        input.engine,
        input.provider,
        input.title,
        input.contentMarkdown,
        input.contentLength,
        input.rawHtml,
        JSON.stringify(input.metadata),
        JSON.stringify(input.og),
        JSON.stringify(input.usage),
        JSON.stringify(input.metrics),
        input.status,
        input.errorCode,
        JSON.stringify(input.fetchAttempts),
        JSON.stringify(input.extractDebug),
      ],
    );
    return mapFetch(rows[0]!);
  },

  async get(db: Db, id: string): Promise<FetchRow | null> {
    const rows = await db.query<RawFetchRow>("select * from fetch_history where id = $1", [id]);
    return rows[0] ? mapFetch(rows[0]) : null;
  },

  async list(db: Db, options: { limit: number; before?: string | null }): Promise<FetchRow[]> {
    const limit = Math.min(Math.max(options.limit, 1), 50);
    const rows = options.before
      ? await db.query<RawFetchRow>(
          "select * from fetch_history where created_at < $1::timestamptz order by created_at desc limit $2",
          [options.before, limit],
        )
      : await db.query<RawFetchRow>("select * from fetch_history order by created_at desc limit $1", [limit]);
    return rows.map(mapFetch);
  },
};

export interface AiRow {
  id: string;
  fetch_id: string;
  kind: string;
  target_language: string | null;
  model: string | null;
  content: unknown;
  cost_usd: number;
  created_at: string;
}

interface RawAiRow extends Omit<AiRow, "created_at" | "cost_usd"> {
  created_at: Date | string;
  cost_usd: string | number;
}

function mapAi(row: RawAiRow): AiRow {
  return { ...row, cost_usd: num(row.cost_usd), created_at: iso(row.created_at) ?? "" };
}

export const aiRepo = {
  async insert(
    db: Db,
    input: { id: string; fetchId: string; kind: string; targetLanguage: string | null; model: string; content: unknown; costUsd: number },
  ): Promise<AiRow> {
    const rows = await db.query<RawAiRow>(
      `insert into ai_results (id, fetch_id, kind, target_language, model, content, cost_usd)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,
      [input.id, input.fetchId, input.kind, input.targetLanguage, input.model, JSON.stringify(input.content), input.costUsd],
    );
    return mapAi(rows[0]!);
  },

  async listByFetch(db: Db, fetchId: string): Promise<AiRow[]> {
    const rows = await db.query<RawAiRow>(
      "select * from ai_results where fetch_id = $1 order by created_at asc",
      [fetchId],
    );
    return rows.map(mapAi);
  },
};

export interface ArchiveRow {
  id: string;
  fetch_id: string;
  channel: string;
  status: string;
  url: string | null;
  external_id: string | null;
  error_code: string | null;
  created_at: string;
}

interface RawArchiveRow extends Omit<ArchiveRow, "created_at"> {
  created_at: Date | string;
}

function mapArchive(row: RawArchiveRow): ArchiveRow {
  return { ...row, created_at: iso(row.created_at) ?? "" };
}

export const archiveRepo = {
  async insert(
    db: Db,
    input: { id: string; fetchId: string; channel: string; status: string; url: string | null; externalId: string | null; errorCode: string | null },
  ): Promise<ArchiveRow> {
    const rows = await db.query<RawArchiveRow>(
      `insert into archive_records (id, fetch_id, channel, status, url, external_id, error_code)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [input.id, input.fetchId, input.channel, input.status, input.url, input.externalId, input.errorCode],
    );
    return mapArchive(rows[0]!);
  },

  async listByFetch(db: Db, fetchId: string): Promise<ArchiveRow[]> {
    const rows = await db.query<RawArchiveRow>(
      "select * from archive_records where fetch_id = $1 order by created_at asc",
      [fetchId],
    );
    return rows.map(mapArchive);
  },
};

export interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string[];
  enabled: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface RawTokenRow extends Omit<TokenRow, "created_at" | "last_used_at"> {
  created_at: Date | string;
  last_used_at: Date | string | null;
}

function mapToken(row: RawTokenRow): TokenRow {
  return {
    ...row,
    created_at: iso(row.created_at) ?? "",
    last_used_at: iso(row.last_used_at),
  };
}

export const tokenRepo = {
  async create(
    db: Db,
    input: { id: string; name: string; prefix: string; hash: string; scopes: string[] },
  ): Promise<TokenRow> {
    const rows = await db.query<RawTokenRow>(
      `insert into api_tokens (id, name, token_prefix, token_hash, scopes)
       values ($1,$2,$3,$4,$5) returning *`,
      [input.id, input.name, input.prefix, input.hash, input.scopes],
    );
    return mapToken(rows[0]!);
  },

  async findByPrefix(db: Db, prefix: string): Promise<TokenRow[]> {
    const rows = await db.query<RawTokenRow>(
      "select * from api_tokens where token_prefix = $1 and enabled = true",
      [prefix],
    );
    return rows.map(mapToken);
  },

  async touch(db: Db, id: string): Promise<void> {
    await db.query("update api_tokens set last_used_at = now() where id = $1", [id]);
  },

  async list(db: Db): Promise<TokenRow[]> {
    const rows = await db.query<RawTokenRow>("select * from api_tokens order by created_at desc");
    return rows.map(mapToken);
  },
};

export interface TelegramBindingRow {
  id: string;
  chat_id: string;
  title: string | null;
  settings: TelegramSettings;
  active: boolean;
  bound_at: string;
}

export interface TelegramSettings {
  lang: string;
  translate: boolean;
  archive: boolean;
  summary_length: "short" | "medium" | "long";
}

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  lang: "zh",
  translate: false,
  archive: true,
  summary_length: "medium",
};

interface RawBindingRow extends Omit<TelegramBindingRow, "bound_at" | "chat_id"> {
  chat_id: string | number | bigint;
  bound_at: Date | string;
}

function mapBinding(row: RawBindingRow): TelegramBindingRow {
  return {
    ...row,
    chat_id: String(row.chat_id),
    settings: { ...DEFAULT_TELEGRAM_SETTINGS, ...(row.settings ?? {}) },
    bound_at: iso(row.bound_at) ?? "",
  };
}

export const telegramRepo = {
  async getBinding(db: Db, chatId: string | number): Promise<TelegramBindingRow | null> {
    const rows = await db.query<RawBindingRow>("select * from telegram_bindings where chat_id = $1 and active = true", [
      String(chatId),
    ]);
    return rows[0] ? mapBinding(rows[0]) : null;
  },

  async upsertBinding(db: Db, input: { id: string; chatId: string | number; title: string | null }): Promise<TelegramBindingRow> {
    const rows = await db.query<RawBindingRow>(
      `insert into telegram_bindings (id, chat_id, title, settings, active)
       values ($1,$2,$3,$4::jsonb,true)
       on conflict (chat_id) do update set active = true, title = excluded.title
       returning *`,
      [input.id, String(input.chatId), input.title, JSON.stringify(DEFAULT_TELEGRAM_SETTINGS)],
    );
    return mapBinding(rows[0]!);
  },

  async updateSettings(db: Db, chatId: string | number, settings: TelegramSettings): Promise<void> {
    await db.query("update telegram_bindings set settings = $2::jsonb where chat_id = $1", [
      String(chatId),
      JSON.stringify(settings),
    ]);
  },

  async deactivate(db: Db, chatId: string | number): Promise<void> {
    await db.query("update telegram_bindings set active = false where chat_id = $1", [String(chatId)]);
  },

  /** Returns false when the update was already processed (Telegram retry). */
  async startLog(
    db: Db,
    input: { id: string; chatId: string | number; updateId: number; url: string | null },
  ): Promise<boolean> {
    const rows = await db.query<{ id: string }>(
      `insert into telegram_logs (id, chat_id, update_id, url, status)
       values ($1,$2,$3,$4,'processing')
       on conflict (update_id) do nothing
       returning id`,
      [input.id, String(input.chatId), String(input.updateId), input.url],
    );
    return rows.length > 0;
  },

  async finishLog(
    db: Db,
    updateId: number,
    input: { status: string; fetchId?: string | null; errorCode?: string | null },
  ): Promise<void> {
    await db.query(
      "update telegram_logs set status = $2, fetch_id = $3, error_code = $4, finished_at = now() where update_id = $1",
      [String(updateId), input.status, input.fetchId ?? null, input.errorCode ?? null],
    );
  },

  async recentLogs(db: Db, limit = 20): Promise<Array<{ chat_id: string; status: string; url: string | null; error_code: string | null; created_at: string }>> {
    const rows = await db.query<{ chat_id: string; status: string; url: string | null; error_code: string | null; created_at: Date | string }>(
      "select chat_id, status, url, error_code, created_at from telegram_logs order by created_at desc limit $1",
      [Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map((r) => ({ ...r, chat_id: String(r.chat_id), created_at: iso(r.created_at) ?? "" }));
  },
};

export const settingsRepo = {
  async get<T>(db: Db, key: string): Promise<T | null> {
    const rows = await db.query<{ value: T }>("select value from app_settings where key = $1", [key]);
    return rows[0]?.value ?? null;
  },

  async set(db: Db, key: string, value: unknown): Promise<void> {
    await db.query(
      `insert into app_settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  },
};

export interface RateLimitOutcome {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: string;
}

interface RawRateLimit {
  allowed: boolean;
  count: number;
  limit: number;
  reset_at: string;
}

export const rateLimitRepo = {
  async bump(db: Db, key: string, limit: number, windowSeconds: number): Promise<RateLimitOutcome> {
    const rows = await db.query<{ result: RawRateLimit }>(
      "select bump_rate_limit($1, $2, $3) as result",
      [key, limit, windowSeconds],
    );
    const result = rows[0]!.result;
    return {
      allowed: Boolean(result.allowed),
      count: result.count,
      limit: result.limit,
      resetAt: result.reset_at,
    };
  },
};
