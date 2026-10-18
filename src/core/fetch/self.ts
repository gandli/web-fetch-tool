import type { AppConfig } from "../../config.ts";
import type { ResolveHost } from "../url-guard.ts";
import { fetchDocument } from "./http.ts";
import type { RawDocument } from "./common.ts";

export interface FetcherContext {
  config: AppConfig;
  fetchImpl: typeof fetch;
  resolveHost: ResolveHost;
}

/** Zero-cost channel: direct server-side HTTP request. */
export async function selfFetch(url: string, ctx: FetcherContext): Promise<RawDocument> {
  const startedAt = Date.now();
  const document = await fetchDocument(url, {
    fetchImpl: ctx.fetchImpl,
    resolveHost: ctx.resolveHost,
    timeoutMs: ctx.config.httpTimeoutMs,
    maxBytes: ctx.config.maxHtmlBytes,
  });
  return {
    provider: "self",
    finalUrl: document.finalUrl,
    html: document.text,
    latencyMs: document.latencyMs || Date.now() - startedAt,
    costUsd: 0,
    notes: [`self fetch ${document.bytes} bytes${document.truncated ? " (truncated)" : ""}`],
  };
}
