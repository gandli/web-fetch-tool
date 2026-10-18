import { AppError, isAppError } from "../../contracts/errors.ts";
import type { FetchAttempt } from "../../contracts/types.ts";
import type { PlatformRoute } from "../platform.ts";
import type { RawDocument } from "./common.ts";
import type { FetcherContext } from "./self.ts";
import { selfFetch } from "./self.ts";
import { jinaFetch } from "./jina.ts";
import { xFetch } from "./x.ts";
import { wechatFetch } from "./wechat.ts";
import { githubFetch } from "./github.ts";
import { findPaidEngine, paidEngines } from "./paid.ts";

export interface ChainResult {
  doc: RawDocument;
  attempts: FetchAttempt[];
}

function errorCode(error: unknown): FetchAttempt["error_code"] {
  if (isAppError(error)) return error.code;
  return "fetch_failed";
}

interface Candidate {
  engine: string;
  run: () => Promise<RawDocument>;
}

/**
 * Free-first fallback chain. Every attempt is recorded with its provider and
 * upstream latency; a failing/slow provider never aborts the whole fetch.
 */
export async function fetchWithChain(
  url: URL,
  route: PlatformRoute,
  ctx: FetcherContext,
  requestedEngine = "auto",
): Promise<ChainResult> {
  const attempts: FetchAttempt[] = [];
  const engine = requestedEngine.trim().toLowerCase();

  const candidates: Candidate[] = [];

  if (engine && engine !== "auto") {
    candidates.push({
      engine,
      run: () => runExplicit(engine, url, route, ctx),
    });
  } else if (route.platform === "x") {
    candidates.push({ engine: "fxtwitter", run: () => xFetch(url, ctx) });
  } else if (route.platform === "wechat") {
    candidates.push({ engine: "wechat-native", run: () => wechatFetch(url.toString(), ctx) });
    candidates.push({ engine: "jina", run: () => jinaFetch(url.toString(), ctx) });
  } else if (route.platform === "github") {
    candidates.push({ engine: "github-api", run: () => githubFetch(url, ctx) });
  } else {
    candidates.push({ engine: "self", run: () => selfFetch(url.toString(), ctx) });
    candidates.push({ engine: "jina", run: () => jinaFetch(url.toString(), ctx) });
  }

  if (!engine || engine === "auto") {
    for (const paid of paidEngines) {
      if (!paid.isConfigured(ctx.config)) continue;
      candidates.push({ engine: paid.name, run: () => paid.fetch(url.toString(), ctx) });
    }
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    const startedAt = Date.now();
    try {
      const doc = await candidate.run();
      attempts.push({
        engine: candidate.engine,
        status: "ok",
        upstream_latency_ms: doc.latencyMs || Date.now() - startedAt,
      });
      return { doc, attempts };
    } catch (error) {
      lastError = error;
      const code = errorCode(error);
      attempts.push({
        engine: candidate.engine,
        status: code === "fetch_timeout" ? "timeout" : "failed",
        upstream_latency_ms: Date.now() - startedAt,
        error_code: code,
      });
    }
  }

  if (isAppError(lastError)) throw lastError;
  throw new AppError("provider_unavailable", lastError instanceof Error ? lastError.message : String(lastError));
}

async function runExplicit(engine: string, url: URL, route: PlatformRoute, ctx: FetcherContext): Promise<RawDocument> {
  switch (engine) {
    case "self":
      return selfFetch(url.toString(), ctx);
    case "jina":
      return jinaFetch(url.toString(), ctx);
    case "fxtwitter":
      return xFetch(url, ctx);
    case "wechat-native":
      return wechatFetch(url.toString(), ctx);
    case "github-api":
      return githubFetch(url, ctx);
    default: {
      const paid = findPaidEngine(engine);
      if (!paid) throw new AppError("invalid_body", `unknown engine ${engine}`);
      if (!paid.isConfigured(ctx.config)) throw new AppError("provider_unavailable", `engine ${engine} not configured`);
      return paid.fetch(url.toString(), ctx);
    }
  }
}
