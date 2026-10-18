/**
 * Central configuration. Every capability is optional: a missing secret only
 * disables that capability and never crashes the process.
 */
export interface RateLimitRule {
  perMinute: number;
  perHour: number;
}

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  dbDriver: "pglite" | "pg";
  pglitePath: string;
  databaseUrl: string | undefined;

  apiAuthRequired: boolean;
  apiRateLimit: RateLimitRule;
  historyRateLimit: { perMinute: number };

  httpTimeoutMs: number;
  maxHtmlBytes: number;
  maxContentChars: number;
  maxRequestBodyBytes: number;
  jinaBaseUrl: string;
  githubToken: string | undefined;
  trafilaturaUrl: string | undefined;
  deepwikiEnabled: boolean;

  openrouterApiKey: string | undefined;
  openrouterModelFree: string;
  openrouterModelFallbacks: string[];
  openrouterModelQuality: string | undefined;

  telegraphEnabled: boolean;
  archiveDefaultChannels: string[];

  telegramBotToken: string | undefined;
  telegramWebhookSecret: string | undefined;
  telegramBindCode: string | undefined;
  telegramAllowedChatIds: string[];
  telegramApiBase: string;
  telegramRateLimit: RateLimitRule;

  serverEncryptionKey: string | undefined;
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, fallback = ""): string {
  const raw = env[key];
  return raw === undefined ? fallback : raw.trim();
}

function optional(env: Env, key: string): string | undefined {
  const v = str(env, key);
  return v.length > 0 ? v : undefined;
}

function int(env: Env, key: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = str(env, key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = str(env, key).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function list(env: Env, key: string, fallback: string[] = []): string[] {
  const raw = str(env, key);
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: Env = process.env as Env): AppConfig {
  const driver = str(env, "DB_DRIVER", "pglite").toLowerCase();
  return {
    port: int(env, "PORT", 8787),
    publicBaseUrl: str(env, "PUBLIC_BASE_URL", "http://127.0.0.1:8787").replace(/\/+$/, ""),
    dbDriver: driver === "pg" ? "pg" : "pglite",
    pglitePath: str(env, "PGLITE_PATH", ".data/pglite"),
    databaseUrl: optional(env, "DATABASE_URL"),

    apiAuthRequired: bool(env, "API_AUTH_REQUIRED", true),
    apiRateLimit: {
      perMinute: int(env, "API_RATE_LIMIT_PER_MINUTE", 30, 1, 10000),
      perHour: int(env, "API_RATE_LIMIT_PER_HOUR", 300, 1, 1000000),
    },
    historyRateLimit: { perMinute: int(env, "HISTORY_RATE_LIMIT_PER_MINUTE", 60, 1, 10000) },

    httpTimeoutMs: int(env, "HTTP_TIMEOUT_MS", 15000, 1000, 60000),
    maxHtmlBytes: int(env, "MAX_HTML_BYTES", 8 * 1024 * 1024, 65536, 64 * 1024 * 1024),
    maxContentChars: int(env, "MAX_CONTENT_CHARS", 60000, 1000, 500000),
    maxRequestBodyBytes: int(env, "MAX_REQUEST_BODY_BYTES", 64 * 1024, 1024, 1024 * 1024),
    jinaBaseUrl: str(env, "JINA_BASE_URL", "https://r.jina.ai").replace(/\/+$/, ""),
    githubToken: optional(env, "GITHUB_TOKEN"),
    trafilaturaUrl: optional(env, "TRAFILATURA_URL"),
    deepwikiEnabled: bool(env, "DEEPWIKI_ENABLED", false),

    openrouterApiKey: optional(env, "OPENROUTER_API_KEY"),
    openrouterModelFree: str(env, "OPENROUTER_MODEL_FREE", "google/gemma-4-31b-it:free"),
    openrouterModelFallbacks: list(env, "OPENROUTER_MODEL_FALLBACKS", [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "thinkingmachines/inkling:free",
    ]),
    openrouterModelQuality: optional(env, "OPENROUTER_MODEL_QUALITY"),

    telegraphEnabled: bool(env, "TELEGRAPH_ENABLED", true),
    archiveDefaultChannels: list(env, "ARCHIVE_DEFAULT_CHANNELS", ["telegraph"]),

    telegramBotToken: optional(env, "TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret: optional(env, "TELEGRAM_WEBHOOK_SECRET"),
    telegramBindCode: optional(env, "TELEGRAM_BIND_CODE"),
    telegramAllowedChatIds: list(env, "TELEGRAM_ALLOWED_CHAT_IDS"),
    telegramApiBase: str(env, "TELEGRAM_API_BASE", "https://api.telegram.org").replace(/\/+$/, ""),
    telegramRateLimit: {
      perMinute: int(env, "TELEGRAM_RATE_LIMIT_PER_MINUTE", 5, 1, 1000),
      perHour: int(env, "TELEGRAM_RATE_LIMIT_PER_HOUR", 40, 1, 100000),
    },

    serverEncryptionKey: optional(env, "SERVER_ENCRYPTION_KEY"),
  };
}
