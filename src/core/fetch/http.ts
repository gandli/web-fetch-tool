import { AppError } from "../../contracts/errors.ts";
import { validatePublicUrl, type ResolveHost, defaultResolveHost } from "../url-guard.ts";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface DocumentResponse {
  status: number;
  finalUrl: string;
  contentType: string;
  text: string;
  bytes: number;
  truncated: boolean;
  latencyMs: number;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  followRedirects?: boolean;
  maxRedirects?: number;
  resolveHost?: ResolveHost;
}

export interface HttpRequestResult {
  status: number;
  finalUrl: string;
  headers: Headers;
  body: Uint8Array;
  text: string;
  latencyMs: number;
  truncated: boolean;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function abortSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<{ body: Uint8Array; truncated: boolean }> {
  if (!response.body) return { body: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        const keep = maxBytes - total;
        if (keep > 0) chunks.push(value.subarray(0, keep));
        total += Math.max(keep, 0);
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock?.();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, truncated };
}

function normalizeCharset(label: string | undefined): string | null {
  if (!label) return null;
  const value = label.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!value) return null;
  if (value === "gb2312" || value === "gbk" || value === "x-gbk") return "gbk";
  if (value === "iso-8859-1" || value === "latin1" || value === "us-ascii") return "windows-1252";
  if (value === "utf8") return "utf-8";
  return value;
}

/** Decode bytes using content-type charset, then a meta charset sniff, then UTF-8. */
export function decodeBody(body: Uint8Array, contentType: string): string {
  let charset = normalizeCharset(/charset=([^;]+)/i.exec(contentType)?.[1]);
  if (!charset) {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(body.subarray(0, 4096));
    charset = normalizeCharset(/<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]);
  }
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
}

function asFetchError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = (error as { name?: string })?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || name === "TimeoutError" || /timed? ?out|timeout/i.test(message)) {
    return new AppError("fetch_timeout", message);
  }
  return new AppError("fetch_failed", message);
}

/**
 * Low-level bounded HTTP request. Redirects are followed manually only when
 * `followRedirects` is false, so callers can re-validate every hop.
 */
export async function httpRequest(
  target: string,
  options: HttpRequestOptions = {},
): Promise<HttpRequestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? 3;
  const followRedirects = options.followRedirects ?? false;
  const startedAt = Date.now();

  let current = target;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: options.method ?? "GET",
        headers: {
          "user-agent": DEFAULT_USER_AGENT,
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          ...(options.headers ?? {}),
        },
        body: options.body,
        redirect: followRedirects ? "follow" : "manual",
        signal: abortSignal(timeoutMs),
      });
    } catch (error) {
      throw asFetchError(error);
    }

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && location;
    if (isRedirect && !followRedirects) {
      if (hop === maxRedirects) {
        await response.body?.cancel().catch(() => {});
        throw new AppError("too_many_redirects", `exceeded ${maxRedirects} redirects at ${current}`);
      }
      const next = new URL(location, current);
      // Re-validate the redirect target (structure + DNS) before following.
      await validatePublicUrl(next.toString(), options.resolveHost ?? defaultResolveHost);
      current = next.toString();
      await response.body?.cancel().catch(() => {});
      continue;
    }

    const { body, truncated } = await readLimited(response, maxBytes);
    const contentType = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      finalUrl: response.url || current,
      headers: response.headers,
      body,
      text: decodeBody(body, contentType),
      latencyMs: Date.now() - startedAt,
      truncated,
    };
  }
  throw new AppError("too_many_redirects", "redirect loop");
}

export interface DocumentFetchOptions {
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

/**
 * Fetch an HTML page for extraction. Validates the URL and every redirect hop
 * against the SSRF guard, and rejects non-text content types.
 */
export async function fetchDocument(target: string, options: DocumentFetchOptions = {}): Promise<DocumentResponse> {
  const config = {
    fetchImpl: options.fetchImpl ?? fetch,
    resolveHost: options.resolveHost ?? defaultResolveHost,
  };
  await validatePublicUrl(target, config.resolveHost);

  const result = await httpRequest(target, {
    fetchImpl: config.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      ...(options.headers ?? {}),
    },
  });

  if (result.status >= 400) {
    throw new AppError("fetch_failed", `upstream status ${result.status} for ${result.finalUrl}`);
  }

  const contentType = result.headers.get("content-type") ?? "";
  const normalized = contentType.toLowerCase();
  const allowed =
    normalized.includes("text/html") ||
    normalized.includes("application/xhtml") ||
    normalized.includes("text/plain") ||
    normalized.includes("application/xml") ||
    normalized.includes("text/xml") ||
    normalized.length === 0;
  if (!allowed) {
    throw new AppError("unsupported_content", `content-type ${contentType}`);
  }

  return {
    status: result.status,
    finalUrl: result.finalUrl,
    contentType,
    text: result.text,
    bytes: result.body.byteLength,
    truncated: result.truncated,
    latencyMs: result.latencyMs,
  };
}

/** Fetch a JSON API on a trusted, fixed host (no SSRF guard, still bounded). */
export async function fetchJson<T>(
  target: string,
  options: HttpRequestOptions = {},
): Promise<{ data: T; status: number; latencyMs: number }> {
  const result = await httpRequest(target, {
    ...options,
    followRedirects: options.followRedirects ?? true,
    headers: { accept: "application/json", ...(options.headers ?? {}) },
  });
  if (result.status >= 400) {
    throw new AppError("fetch_failed", `upstream status ${result.status} for ${target}`);
  }
  try {
    return { data: JSON.parse(result.text) as T, status: result.status, latencyMs: result.latencyMs };
  } catch {
    throw new AppError("fetch_failed", `invalid json from ${target}`);
  }
}
