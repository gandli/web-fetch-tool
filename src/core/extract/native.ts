import { DOMParser } from "linkedom";
import type { ExtractedContent } from "../../contracts/types.ts";
import { extractImages } from "./images.ts";
import { htmlToMarkdown, normalizeMarkdown, visibleTextLength } from "./markdown.ts";
import { detectLanguage } from "./language.ts";

export interface NativeExtractInput {
  html: string;
  url: string;
  /** Selector for the article body. */
  contentSelector: string;
  titleSelector?: string;
  authorSelector?: string;
  publishedSelector?: string;
  siteName?: string | null;
  maxChars?: number;
}

function textOf(document: Document | Element, selector: string | undefined): string | null {
  if (!selector) return null;
  const node = document.querySelector(selector);
  const text = node?.textContent?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/**
 * Extract a page whose markup is known (WeChat articles, for example) without
 * running the generic cascade. Falls back to `null` so the caller can use the
 * generic chain.
 */
export function nativeExtract(input: NativeExtractInput): ExtractedContent | null {
  const { html, url, contentSelector } = input;
  const document = new DOMParser().parseFromString(html, "text/html") as unknown as Document;
  if (!document) return null;
  const container = document.querySelector(contentSelector);
  if (!container) return null;

  const markdown = normalizeMarkdown(htmlToMarkdown(container.innerHTML, url));
  if (markdown.length < 80) return null;

  const images = extractImages(container, url);
  const text = (container.textContent ?? "").replace(/\s+/g, " ").trim();
  const language = detectLanguage(text, document.documentElement?.getAttribute("lang"));
  const maxChars = input.maxChars;

  return {
    markdown: maxChars && markdown.length > maxChars ? `${markdown.slice(0, maxChars)}\n\n> 内容过长，已截断。` : markdown,
    text,
    title: textOf(document, input.titleSelector) ?? document.title?.trim() ?? null,
    author: textOf(document, input.authorSelector),
    publishedAt: textOf(document, input.publishedSelector),
    language,
    images,
    siteName: input.siteName ?? null,
    extractor: "native",
    debug: {
      precision_length: visibleTextLength(markdown),
      recall_length: 0,
      chosen: "native",
      notes: [`native selector ${contentSelector}`],
    },
  };
}
