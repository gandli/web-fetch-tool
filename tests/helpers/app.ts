import { randomUUID } from "node:crypto";
import { createApp, type App } from "../../src/app.ts";
import { loadConfig, type AppConfig } from "../../src/config.ts";
import { migrate } from "../../src/db/migrate.ts";
import { PgliteDb } from "../../src/db/pglite.ts";
import { tokenRepo } from "../../src/db/repositories.ts";
import { issueToken } from "../../src/auth/tokens.ts";
import type { Db } from "../../src/db/db.ts";

export const MIGRATIONS = `${import.meta.dir}/../../migrations`;

export const PUBLIC_IP = "93.184.216.34";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({} as Record<string, string | undefined>),
    dbDriver: "pglite",
    pglitePath: ":memory:",
    apiAuthRequired: true,
    openrouterApiKey: undefined,
    telegraphEnabled: false,
    archiveDefaultChannels: [],
    telegramBotToken: "123:TEST",
    telegramApiBase: "http://bot.test",
    telegramWebhookSecret: "webhook-secret",
    telegramBindCode: "bind-code-123",
    ...overrides,
  };
}

export interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

export type FakeHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

export function fakeFetch(handler: FakeHandler, captured: CapturedRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

export const ARTICLE_HTML = `<!doctype html>
<html lang="en"><head>
<title>Deterministic Article</title>
<meta property="og:title" content="Deterministic Article" />
<meta property="og:description" content="A fixture page used by tests." />
<meta property="og:site_name" content="Fixture Site" />
<meta property="og:image" content="/assets/hero.png" />
</head>
<body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article>
  <h1>Deterministic Article</h1>
  <p>${"The pipeline extracts this paragraph deterministically. ".repeat(12)}</p>
  <p>${"Regression tests keep the extraction cascade honest. ".repeat(12)}</p>
  <img src="/assets/inline.jpg" alt="inline" width="800" height="450" />
</article>
<footer>Copyright fixture</footer>
</body></html>`;

export const JINA_RESPONSE = {
  code: 200,
  status: 20000,
  data: {
    title: "Jina Fallback Article",
    description: "fallback content",
    url: "https://example.com/",
    content:
      "# Jina Fallback Article\n\nThis markdown came from the Jina Reader fallback channel, which is used when the direct request fails.",
  },
};

export async function setupApp(options: {
  config?: Partial<AppConfig>;
  handler?: FakeHandler;
  secret?: boolean;
} = {}): Promise<{
  app: App;
  db: Db;
  config: AppConfig;
  token: string;
  captured: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const config = testConfig(options.config);
  const db = new PgliteDb();
  await migrate(db, MIGRATIONS);

  const issued = issueToken();
  await tokenRepo.create(db, {
    id: randomUUID(),
    name: "test",
    prefix: issued.prefix,
    hash: issued.hash,
    scopes: ["fetch", "ai", "read"],
  });

  const captured: CapturedRequest[] = [];
  const handler =
    options.handler ??
    ((url: string) => {
      if (url.includes("r.jina.ai")) {
        return new Response(JSON.stringify(JINA_RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    });

  const app = createApp({
    config,
    db,
    fetchImpl: fakeFetch(handler, captured),
    resolveHost: async () => [PUBLIC_IP],
  });

  return {
    app,
    db,
    config,
    token: issued.token,
    captured,
    close: async () => {
      await db.close();
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}
