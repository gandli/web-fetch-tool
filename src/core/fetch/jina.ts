import { AppError } from "../../contracts/errors.ts";
import type { RawDocument } from "./common.ts";
import { fetchJson } from "./http.ts";
import type { FetcherContext } from "./self.ts";

interface JinaResponse {
  code?: number;
  status?: number;
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
  };
  message?: string;
}

/**
 * Jina Reader: keyless markdown extraction. Free tier is rate limited, so this
 * is a fallback rather than the default channel.
 */
export async function jinaFetch(url: string, ctx: FetcherContext): Promise<RawDocument> {
  const endpoint = `${ctx.config.jinaBaseUrl}/${url.replace(/^https?:\/\//, "")}`;
  const { data, latencyMs } = await fetchJson<JinaResponse>(endpoint, {
    fetchImpl: ctx.fetchImpl,
    headers: { accept: "application/json", "x-respond-with": "markdown" },
    timeoutMs: Math.max(ctx.config.httpTimeoutMs, 20000),
    maxBytes: 8 * 1024 * 1024,
  });

  const content = data.data?.content;
  if (!content || !content.trim()) {
    throw new AppError("fetch_failed", `jina empty content (${data.message ?? data.code ?? "unknown"})`);
  }
  return {
    provider: "jina",
    finalUrl: data.data?.url ?? url,
    markdown: content,
    title: data.data?.title ?? null,
    author: null,
    publishedAt: null,
    images: [],
    latencyMs,
    costUsd: 0,
    notes: ["jina reader markdown"],
  };
}
