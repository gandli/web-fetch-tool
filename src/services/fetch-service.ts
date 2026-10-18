import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.ts";
import type { UnifiedResult } from "../contracts/types.ts";
import { fetchRepo, type FetchRow } from "../db/repositories.ts";
import type { Db } from "../db/db.ts";
import { runPipeline } from "../core/pipeline.ts";
import { ResultCache } from "../core/dedupe.ts";
import type { ResolveHost } from "../core/url-guard.ts";
import { defaultResolveHost } from "../core/url-guard.ts";

export interface ExecuteFetchInput {
  url: string;
  engine?: string;
  config: AppConfig;
  db: Db;
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  cache?: ResultCache<unknown>;
}

export interface ExecuteFetchResult {
  row: FetchRow;
  unified: UnifiedResult;
}

const RAW_HTML_DB_LIMIT = 2 * 1024 * 1024;

export function toUnified(row: FetchRow): UnifiedResult {
  const og = row.og as { image?: string | null; title?: string | null; description?: string | null; site_name?: string | null };
  const metadata = row.metadata as { author?: string | null; published_at?: string | null; language?: string | null };
  const usage = row.usage as { fetch_cost_usd?: number };
  const metrics = row.metrics as { response_time_ms?: number; upstream_latency_ms?: number };

  return {
    id: row.id,
    created_at: row.created_at,
    provider: row.provider,
    url: row.url,
    title: row.title ?? row.url,
    platform: row.platform as UnifiedResult["platform"],
    content: {
      format: "markdown",
      text: row.content_markdown ?? "",
      length: row.content_length,
    },
    metadata: {
      author: metadata.author ?? null,
      published_at: metadata.published_at ?? null,
      language: metadata.language ?? null,
    },
    og: {
      image: og.image ?? null,
      title: og.title ?? null,
      description: og.description ?? null,
      site_name: og.site_name ?? null,
    },
    usage: { fetch_cost_usd: usage.fetch_cost_usd ?? 0 },
    metrics: {
      response_time_ms: metrics.response_time_ms ?? 0,
      upstream_latency_ms: metrics.upstream_latency_ms ?? 0,
    },
    status: row.status as UnifiedResult["status"],
  };
}

/**
 * Shared by the HTTP API and the Telegram bot: run the pipeline once, persist
 * exactly one history row, and return both the row and the public shape.
 */
export async function executeFetch(input: ExecuteFetchInput): Promise<ExecuteFetchResult> {
  const startedAt = Date.now();
  const engine = input.engine ?? "auto";
  const resolveHost = input.resolveHost ?? defaultResolveHost;
  const cacheKey = `${engine}|${input.url}`;

  const run = async () =>
    runPipeline({
      url: input.url,
      engine,
      config: input.config,
      fetchImpl: input.fetchImpl ?? fetch,
      resolveHost,
    });

  const result = input.cache
    ? await (input.cache as ResultCache<Awaited<ReturnType<typeof run>>>).getOrCreate(cacheKey, run)
    : await run();

  const responseTimeMs = Date.now() - startedAt;
  const rawHtml = result.rawHtml ? result.rawHtml.slice(0, RAW_HTML_DB_LIMIT) : null;

  const row = await fetchRepo.insert(input.db, {
    id: randomUUID(),
    url: input.url,
    normalizedUrl: result.outcome.finalUrl,
    platform: result.outcome.platform,
    engine,
    provider: result.outcome.provider,
    title: result.outcome.extracted.title,
    contentMarkdown: result.outcome.extracted.markdown,
    contentLength: result.outcome.extracted.markdown.length,
    rawHtml,
    metadata: {
      author: result.outcome.extracted.author,
      published_at: result.outcome.extracted.publishedAt,
      language: result.outcome.extracted.language,
    },
    og: result.outcome.og,
    usage: { fetch_cost_usd: result.outcome.costUsd },
    metrics: {
      response_time_ms: responseTimeMs,
      upstream_latency_ms: result.outcome.upstreamLatencyMs,
    },
    status: "ok",
    errorCode: null,
    fetchAttempts: result.outcome.attempts,
    extractDebug: result.outcome.extracted.debug,
  });

  return { row, unified: toUnified(row) };
}
