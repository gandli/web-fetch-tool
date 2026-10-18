import { DOMParser } from "linkedom";
import { AppError } from "../contracts/errors.ts";
import type { ExtractedContent, FetchOutcome, OgInfo, Platform } from "../contracts/types.ts";
import type { AppConfig } from "../config.ts";
import { detectPlatform, type PlatformRoute } from "./platform.ts";
import { validatePublicUrl, type ResolveHost } from "./url-guard.ts";
import { fetchWithChain } from "./fetch/chain.ts";
import type { RawDocument } from "./fetch/common.ts";
import { firstLine } from "./fetch/common.ts";
import { extractOg } from "./og.ts";
import { extractArticle } from "./extract/cascade.ts";
import { detectLanguage } from "./extract/language.ts";
import { normalizeMarkdown } from "./extract/markdown.ts";

export interface PipelineInput {
  url: string;
  engine?: string;
  config: AppConfig;
  fetchImpl?: typeof fetch;
  resolveHost: ResolveHost;
}

export interface PipelineResult {
  outcome: FetchOutcome;
  rawHtml: string | null;
}

function placeholderUrl(config: AppConfig): string {
  return `${config.publicBaseUrl}/static/placeholder.svg`;
}

function fromMarkdown(doc: RawDocument, platform: Platform, config: AppConfig): ExtractedContent {
  const markdown = normalizeMarkdown(doc.markdown ?? "");
  const limited =
    markdown.length > config.maxContentChars
      ? `${markdown.slice(0, config.maxContentChars)}\n\n> 内容过长，已截断。`
      : markdown;
  return {
    markdown: limited,
    text: limited,
    title: doc.title ?? firstLine(limited),
    author: doc.author ?? null,
    publishedAt: doc.publishedAt ?? null,
    language: doc.language ?? detectLanguage(limited),
    images: doc.images ?? [],
    siteName: doc.ogOverride?.site_name ?? null,
    extractor: doc.provider === "jina" ? "jina" : "native",
    debug: {
      precision_length: limited.length,
      recall_length: 0,
      chosen: doc.provider,
      notes: doc.notes ?? [],
    },
  };
}

function mergeOg(doc: RawDocument, images: string[], fallback: OgInfo, platform: Platform): OgInfo {
  const override = doc.ogOverride ?? {};
  return {
    image: override.image ?? fallback.image ?? images[0] ?? null,
    title: override.title ?? fallback.title ?? null,
    description: override.description ?? fallback.description ?? null,
    site_name: override.site_name ?? fallback.site_name ?? (platform === "x" ? "X" : null),
  };
}

/**
 * The shared business pipeline: platform detection -> free-first fetch ->
 * extraction (or structured content) -> OG fallback chain -> unified outcome.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { config } = input;
  const validated = await validatePublicUrl(input.url, input.resolveHost);

  let route: PlatformRoute;
  try {
    route = detectPlatform(validated.url);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("platform_unsupported", String(error));
  }
  if (route.experimental) {
    throw new AppError("platform_experimental", `${route.platform} requires browser rendering`);
  }

  const { doc, attempts } = await fetchWithChain(
    validated.url,
    route,
    { config, fetchImpl: input.fetchImpl ?? fetch, resolveHost: input.resolveHost },
    input.engine ?? "auto",
  );

  const placeholder = placeholderUrl(config);
  let extracted: ExtractedContent;
  let og: OgInfo;
  let rawHtml: string | null = null;

  if (doc.markdown && doc.provider !== "self") {
    if (route.platform === "wechat" && /环境异常|完成验证|访问过于频繁|内容已被删除|链接已失效/.test(doc.markdown.slice(0, 2000))) {
      throw new AppError("content_empty", `wechat provider ${doc.provider} returned a verification page`);
    }
    extracted = fromMarkdown(doc, route.platform, config);
    const originFavicon = (() => {
      try {
        return new URL("/favicon.ico", doc.finalUrl).toString();
      } catch {
        return null;
      }
    })();
    const fallback: OgInfo = {
      image: originFavicon,
      title: doc.title ?? extracted.title,
      description: null,
      site_name: null,
    };
    og = mergeOg(doc, extracted.images, fallback, route.platform);
    if (!og.image) og.image = placeholder;
  } else if (doc.html) {
    rawHtml = doc.html;
    const dom = new DOMParser().parseFromString(doc.html, "text/html") as unknown as Document;
    const ogExtraction = extractOg(dom, doc.finalUrl, { placeholder });
    og = mergeOg(doc, [], ogExtraction.og, route.platform);

    extracted = await extractArticle(doc.html, doc.finalUrl, {
      og,
      maxChars: config.maxContentChars,
      trafilaturaUrl: config.trafilaturaUrl,
      fetchImpl: input.fetchImpl ?? fetch,
      timeoutMs: config.httpTimeoutMs,
    });
    og = {
      image: og.image ?? extracted.images[0] ?? ogExtraction.favicon ?? placeholder,
      title: og.title ?? extracted.title,
      description: og.description,
      site_name: og.site_name,
    };
  } else {
    throw new AppError("content_empty", `provider ${doc.provider} returned no content`);
  }

  if (!extracted.markdown.trim()) {
    throw new AppError("content_empty", `empty markdown from ${doc.provider}`);
  }

  const title = extracted.title ?? og.title ?? new URL(doc.finalUrl).hostname;
  const outcome: FetchOutcome = {
    platform: route.platform,
    provider: doc.provider,
    finalUrl: doc.finalUrl,
    upstreamLatencyMs: doc.latencyMs,
    costUsd: doc.costUsd,
    attempts,
    extracted,
    og: {
      image: og.image ?? placeholder,
      title: og.title ?? title,
      description: og.description ?? null,
      site_name: og.site_name ?? null,
    },
  };
  outcome.extracted.title = title;
  return { outcome, rawHtml };
}
