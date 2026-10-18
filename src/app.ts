import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.ts";
import type { Db } from "./db/db.ts";
import { aiRepo, archiveRepo, fetchRepo } from "./db/repositories.ts";
import type { AiProvider, AiRequest } from "./ai/types.ts";
import { createAiProvider } from "./ai/openrouter.ts";
import { runAiTask } from "./ai/tasks.ts";
import { authenticate } from "./auth/tokens.ts";
import { apiRules, enforceLimits } from "./auth/rate-limit.ts";
import { AppError } from "./contracts/errors.ts";
import { aiRequestSchema, archiveRequestSchema, fetchRequestSchema, historyQuerySchema, searchQuerySchema } from "./contracts/schemas.ts";
import type { UnifiedResult } from "./contracts/types.ts";
import { executeFetch, toUnified } from "./services/fetch-service.ts";
import { searchHistory } from "./search/service.ts";
import { runArchive, archiveChannelNames, getArchiveAdapter } from "./archive/index.ts";
import { paidEngines } from "./core/fetch/paid.ts";
import { ResultCache } from "./core/dedupe.ts";
import type { ResolveHost } from "./core/url-guard.ts";
import { defaultResolveHost } from "./core/url-guard.ts";
import { docsPage, FAVICON_SVG, PLACEHOLDER_SVG } from "./docs-page.ts";
import { clientIp, readJson } from "./http/request.ts";
import { errorResponse, html, json, preflight, redirect, svg } from "./http/respond.ts";
import { processTelegramUpdate, type TelegramUpdate } from "./telegram/webhook.ts";

export interface AppDeps {
  config: AppConfig;
  db: Db;
  aiProvider?: AiProvider;
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  cache?: ResultCache<unknown>;
}

export interface App {
  handle(request: Request): Promise<Response>;
  drainBackground(): Promise<void>;
  readonly deps: { config: AppConfig; db: Db; aiProvider: AiProvider };
}

function summarizeAiErrors(results: PromiseSettledResult<unknown>[]): string | null {
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (!failure) return null;
  const reason = failure.reason as { code?: string };
  return typeof reason?.code === "string" ? reason.code : "ai_failed";
}

export function createApp(input: AppDeps): App {
  const config = input.config;
  const db = input.db;
  const fetchImpl = input.fetchImpl ?? fetch;
  const resolveHost = input.resolveHost ?? defaultResolveHost;
  const aiProvider = input.aiProvider ?? createAiProvider(config, fetchImpl);
  const cache = (input.cache as ResultCache<unknown> | undefined) ?? new ResultCache<unknown>(60_000);
  const background = new Set<Promise<void>>();

  async function guard(request: Request, scope: "fetch" | "ai") {
    const auth = await authenticate(db, request.headers, scope, { required: config.apiAuthRequired });
    const key = auth ? `api:${auth.token.id}` : `ip:${clientIp(request)}`;
    await enforceLimits(db, key, apiRules(config.apiRateLimit.perMinute, config.apiRateLimit.perHour));
    return auth;
  }

  async function guardRead(request: Request, namespace: string) {
    await enforceLimits(db, `ip:${clientIp(request)}:${namespace}`, [
      { limit: config.historyRateLimit.perMinute, windowSeconds: 60, keySuffix: "m" },
    ]);
  }

  async function handleFetch(request: Request): Promise<Response> {
    await guard(request, "fetch");
    const parsed = fetchRequestSchema.safeParse(await readJson(request, config.maxRequestBodyBytes));
    if (!parsed.success) throw new AppError("invalid_body", parsed.error.message);
    const body = parsed.data;

    const { row, unified } = await executeFetch({
      url: body.url,
      engine: body.engine,
      config,
      db,
      fetchImpl,
      resolveHost,
      cache,
    });

    let aiBlock: Record<string, unknown> | undefined;
    if (body.ai) {
      if (!aiProvider.available) {
        aiBlock = { available: false };
      } else {
        const language = body.ai.language ?? "zh";
        const tasks: AiRequest[] = [];
        if (body.ai.summary) tasks.push({ task: "summarize", text: unified.content.text, title: unified.title, language, summaryLength: "medium" });
        if (body.ai.tags) tasks.push({ task: "tags", text: unified.content.text, title: unified.title, language });
        if (body.ai.translate) tasks.push({ task: "translate", text: unified.content.text, title: unified.title, language });
        if (body.ai.analyze) tasks.push({ task: "analyze", text: unified.content.text, title: unified.title, language });

        const results = await Promise.allSettled(tasks.map((task) => runAiTask(aiProvider, task)));
        const ai: Record<string, unknown> = { available: true };
        let cost = 0;
        let model = "";
        results.forEach((result, index) => {
          if (result.status !== "fulfilled") return;
          const task = tasks[index]!;
          cost += result.value.costUsd;
          model = result.value.model || model;
          ai[task.task === "summarize" ? "summary" : task.task] = result.value.content;
          const content =
            typeof result.value.content === "string" ||
            Array.isArray(result.value.content) ||
            (result.value.content && typeof result.value.content === "object")
              ? result.value.content
              : String(result.value.content);
          void aiRepo
            .insert(db, {
              id: randomUUID(),
              fetchId: row.id,
              kind: task.task,
              targetLanguage: language,
              model: result.value.model,
              content,
              costUsd: result.value.costUsd,
            })
            .catch(() => {});
        });
        ai.cost_usd = cost;
        if (model) ai.model = model;
        const errorCode = summarizeAiErrors(results);
        if (errorCode) ai.error = errorCode;
        aiBlock = ai;
      }
    }

    let archives;
    if (body.archive) {
      const channels =
        typeof body.archive === "object" && body.archive.channels
          ? body.archive.channels
          : config.archiveDefaultChannels;
      archives = await runArchive(
        channels,
        { url: unified.url, title: unified.title, markdown: unified.content.text, platform: unified.platform },
        { config, db, fetchImpl },
        row.id,
      );
    }

    return json({ ...unified, ...(aiBlock ? { ai: aiBlock } : {}), ...(archives ? { archives } : {}) });
  }

  async function handleAi(request: Request): Promise<Response> {
    await guard(request, "ai");
    const parsed = aiRequestSchema.safeParse(await readJson(request, config.maxRequestBodyBytes));
    if (!parsed.success) throw new AppError("invalid_body", parsed.error.message);
    const body = parsed.data;

    let row;
    if (body.id) {
      row = await fetchRepo.get(db, body.id);
      if (!row) throw new AppError("not_found", `fetch ${body.id} not found`);
    } else {
      const executed = await executeFetch({
        url: body.url!,
        config,
        db,
        fetchImpl,
        resolveHost,
        cache,
      });
      row = executed.row;
    }

    const text = row.content_markdown ?? "";
    if (!text.trim()) throw new AppError("content_empty", "stored record has no markdown");

    const result = await runAiTask(aiProvider, {
      task: body.task,
      text,
      title: row.title,
      language: body.language ?? "zh",
      summaryLength: body.summary_length ?? "medium",
      quality: body.quality,
    });

    const stored = await aiRepo.insert(db, {
      id: randomUUID(),
      fetchId: row.id,
      kind: body.task,
      targetLanguage: body.language ?? null,
      model: result.model,
      content: result.content,
      costUsd: result.costUsd,
    });

    return json({
      id: stored.id,
      fetch_id: row.id,
      kind: stored.kind,
      model: stored.model,
      content: stored.content,
      cost_usd: stored.cost_usd,
      created_at: stored.created_at,
    });
  }

  async function handleArchive(request: Request): Promise<Response> {
    await guard(request, "fetch");
    const parsed = archiveRequestSchema.safeParse(await readJson(request, config.maxRequestBodyBytes));
    if (!parsed.success) throw new AppError("invalid_body", parsed.error.message);
    const row = await fetchRepo.get(db, parsed.data.id);
    if (!row) throw new AppError("not_found", `fetch ${parsed.data.id} not found`);

    const channels = parsed.data.channels ?? config.archiveDefaultChannels;
    const results = await runArchive(
      channels,
      {
        url: row.url,
        title: row.title ?? row.url,
        markdown: row.content_markdown ?? "",
        platform: row.platform,
      },
      { config, db, fetchImpl },
      row.id,
    );
    return json({ id: row.id, archives: results });
  }

  async function handleSearch(request: Request, url: URL): Promise<Response> {
    await guardRead(request, "search");
    const parsed = searchQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) throw new AppError("invalid_body", parsed.error.message);

    const result = await searchHistory(db, {
      query: parsed.data.q,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      platform: parsed.data.platform ?? null,
      before: parsed.data.before ?? null,
      sort: parsed.data.sort,
    });
    return json(result);
  }

  async function handleHistory(request: Request, url: URL): Promise<Response> {
    await guardRead(request, "history");
    const parsed = historyQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
    });
    if (!parsed.success) throw new AppError("invalid_body", parsed.error.message);

    const rows = await fetchRepo.list(db, { limit: parsed.data.limit ?? 20, before: parsed.data.before ?? null });
    const items = rows.map((row) => {
      const unified = toUnified(row);
      return {
        id: unified.id,
        url: unified.url,
        title: unified.title,
        platform: unified.platform,
        provider: unified.provider,
        status: unified.status,
        og: unified.og,
        content_length: unified.content.length,
        created_at: unified.created_at,
      };
    });
    const nextCursor = rows.length === (parsed.data.limit ?? 20) ? rows[rows.length - 1]!.created_at : null;
    return json({ items, next_cursor: nextCursor });
  }

  async function handleHistoryDetail(request: Request, id: string): Promise<Response> {
    await guardRead(request, "history");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", "invalid id");
    const row = await fetchRepo.get(db, id);
    if (!row) throw new AppError("not_found", `fetch ${id} not found`);

    const unified: UnifiedResult = toUnified(row);
    const [aiRows, archiveRows] = await Promise.all([aiRepo.listByFetch(db, id), archiveRepo.listByFetch(db, id)]);
    return json({
      ...unified,
      ai_results: aiRows.map((item) => ({
        id: item.id,
        kind: item.kind,
        target_language: item.target_language,
        model: item.model,
        content: item.content,
        cost_usd: item.cost_usd,
        created_at: item.created_at,
      })),
      archives: archiveRows.map((item) => ({
        id: item.id,
        channel: item.channel,
        status: item.status,
        url: item.url,
        error_code: item.error_code,
        created_at: item.created_at,
      })),
    });
  }

  async function handleHealth(): Promise<Response> {
    let dbOk = true;
    try {
      await db.query("select 1");
    } catch {
      dbOk = false;
    }
    return json({
      status: dbOk ? "ok" : "degraded",
      version: "0.1.0",
      database: { driver: db.kind, ok: dbOk },
      providers: {
        self: true,
        jina: true,
        fxtwitter: true,
        "wechat-native": true,
        "github-api": true,
        paid: paidEngines.map((engine) => ({ name: engine.name, configured: engine.isConfigured(config) })),
      },
      ai: { configured: aiProvider.available, models: {
        free: config.openrouterModelFree,
        quality: config.openrouterModelQuality ?? null,
        fallbacks: config.openrouterModelFallbacks,
      } },
      archive: {
        channels: archiveChannelNames().map((channel) => ({
          name: channel,
          configured: getArchiveAdapter(channel)?.isConfigured({ config, db, fetchImpl }) ?? false,
        })),
      },
      telegram: {
        configured: Boolean(config.telegramBotToken && config.telegramWebhookSecret),
        bindingOpen: Boolean(config.telegramBindCode) || config.telegramAllowedChatIds.length > 0,
      },
    });
  }

  async function handleTelegramWebhook(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new AppError("not_found", "method not allowed");
    if (!config.telegramWebhookSecret) throw new AppError("telegram_not_configured", "webhook secret unset");
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    const { safeEqual } = await import("./auth/tokens.ts");
    if (!provided || !safeEqual(provided, config.telegramWebhookSecret)) {
      throw new AppError("unauthorized", "telegram secret mismatch");
    }
    const update = (await readJson(request, 256 * 1024)) as TelegramUpdate;
    if (!update || typeof update.update_id !== "number") throw new AppError("invalid_body", "bad update");

    const task = processTelegramUpdate(update, {
      config,
      db,
      aiProvider,
      fetchImpl,
      resolveHost,
      cache,
    }).catch((error) => {
      console.error("[telegram] update failed", error);
    });
    background.add(task);
    void task.finally(() => background.delete(task));
    return json({ ok: true });
  }

  async function route(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return preflight();
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/") return redirect("/api/docs");
    if (path === "/api/docs" && request.method === "GET") return html(docsPage(config));
    if (path === "/static/placeholder.svg") return svg(PLACEHOLDER_SVG);
    if (path === "/static/favicon.svg") return svg(FAVICON_SVG);
    if (path === "/favicon.ico") return redirect("/static/favicon.svg");
    if (path === "/api/health" && request.method === "GET") return handleHealth();
    if (path === "/api/fetch" && request.method === "POST") return handleFetch(request);
    if (path === "/api/ai" && request.method === "POST") return handleAi(request);
    if (path === "/api/archive" && request.method === "POST") return handleArchive(request);
    if (path === "/api/history" && request.method === "GET") return handleHistory(request, url);
    if (path === "/api/search" && request.method === "GET") return handleSearch(request, url);
    if (path.startsWith("/api/history/") && request.method === "GET") {
      return handleHistoryDetail(request, path.slice("/api/history/".length));
    }
    if (path === "/telegram/webhook") return handleTelegramWebhook(request);
    throw new AppError("not_found", `no route for ${request.method} ${path}`);
  }

  return {
    async handle(request: Request): Promise<Response> {
      const startedAt = Date.now();
      try {
        const response = await route(request);
        console.log(`[http] ${request.method} ${new URL(request.url).pathname} ${response.status} ${Date.now() - startedAt}ms`);
        return response;
      } catch (error) {
        const response = errorResponse(error);
        console.log(`[http] ${request.method} ${new URL(request.url).pathname} ${response.status} ${Date.now() - startedAt}ms`);
        return response;
      }
    },
    async drainBackground(): Promise<void> {
      while (background.size > 0) {
        await Promise.allSettled([...background]);
      }
    },
    deps: { config, db, aiProvider },
  };
}
