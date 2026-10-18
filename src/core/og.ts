import type { OgInfo } from "../contracts/types.ts";

export interface OgExtraction {
  og: OgInfo;
  favicon: string | null;
}

function metaMap(document: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const meta of Array.from(document.querySelectorAll("meta"))) {
    const key = (meta.getAttribute("property") ?? meta.getAttribute("name") ?? meta.getAttribute("itemprop") ?? "").trim().toLowerCase();
    const content = meta.getAttribute("content")?.trim();
    if (key && content && !map.has(key)) map.set(key, content);
  }
  return map;
}

function resolveUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseSize(value: string | null): number {
  if (!value) return 0;
  const n = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

const TRACKING_HINTS = /(pixel|tracker|tracking|analytics|beacon|spacer|blank\.|1x1|transparent)/i;

/**
 * First meaningful image in the document. Prefers images declared with a real
 * size, then images inside the article body, and rejects obvious trackers.
 */
export function firstContentImage(document: Document, baseUrl: string): string | null {
  const candidates = Array.from(document.querySelectorAll("img"));
  const scored: Array<{ url: string; score: number }> = [];
  for (const image of candidates) {
    const raw =
      image.getAttribute("src") ??
      image.getAttribute("data-src") ??
      image.getAttribute("data-original") ??
      image.getAttribute("data-actualsrc");
    const url = resolveUrl(raw, baseUrl);
    if (!url) continue;
    if (TRACKING_HINTS.test(url)) continue;
    if (/\.svg(\?|$)/i.test(url)) continue;
    const width = parseSize(image.getAttribute("width"));
    const height = parseSize(image.getAttribute("height"));
    if (width > 0 && width < 200) continue;
    if (height > 0 && height < 150) continue;
    if (/sprite|icon|logo|avatar|emoji|badge/i.test(url) && width < 400) continue;
    let score = 0;
    if (width >= 400 || height >= 250) score += 3;
    if (image.closest("article, main, .article, #js_content, .rich_media_content")) score += 2;
    if (image.getAttribute("alt")) score += 1;
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) score += 1;
    scored.push({ url, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.url ?? null;
}

export function extractOg(
  document: Document,
  baseUrl: string,
  options: { placeholder?: string } = {},
): OgExtraction {
  const meta = metaMap(document);
  const title = document.querySelector("title")?.textContent?.trim() ?? null;

  const image =
    resolveUrl(meta.get("og:image:secure_url"), baseUrl) ??
    resolveUrl(meta.get("og:image:url"), baseUrl) ??
    resolveUrl(meta.get("og:image"), baseUrl) ??
    resolveUrl(meta.get("twitter:image"), baseUrl) ??
    resolveUrl(meta.get("twitter:image:src"), baseUrl) ??
    firstContentImage(document, baseUrl) ??
    null;

  const iconHref =
    document.querySelector('link[rel="icon"]')?.getAttribute("href") ??
    document.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") ??
    document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ??
    null;
  let favicon = resolveUrl(iconHref, baseUrl);
  if (!favicon) {
    try {
      favicon = new URL("/favicon.ico", baseUrl).toString();
    } catch {
      favicon = null;
    }
  }

  return {
    og: {
      image: image ?? favicon ?? options.placeholder ?? null,
      title: meta.get("og:title") ?? meta.get("twitter:title") ?? title ?? null,
      description:
        meta.get("og:description") ??
        meta.get("twitter:description") ??
        meta.get("description") ??
        null,
      site_name:
        meta.get("og:site_name") ??
        meta.get("application-name") ??
        (() => {
          try {
            return new URL(baseUrl).hostname.replace(/^www\./, "");
          } catch {
            return null;
          }
        })(),
    },
    favicon,
  };
}

export function absoluteImage(value: string | null, baseUrl: string): string | null {
  return resolveUrl(value, baseUrl);
}
