import { DOMParser } from "linkedom";
import TurndownService from "turndown";
import * as turndownGfm from "turndown-plugin-gfm";

type GfmPlugin = (service: TurndownService) => void;
const gfmPlugin: GfmPlugin | undefined =
  (turndownGfm as unknown as { gfm?: GfmPlugin }).gfm ??
  (turndownGfm as unknown as { default?: { gfm?: GfmPlugin } }).default?.gfm;

function createService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  if (gfmPlugin) service.use(gfmPlugin);
  service.addRule("strip", {
    filter: (node) => ["script", "style", "noscript", "svg", "iframe", "form", "button"].includes(node.nodeName.toLowerCase()),
    replacement: () => "",
  });
  service.addRule("figure", {
    filter: "figure",
    replacement: (content, node) => {
      const img = (node as unknown as Element).querySelector?.("img");
      const src = img?.getAttribute("src") ?? "";
      const alt = img?.getAttribute("alt") ?? "";
      const caption = content.trim();
      if (src) return `\n\n![${alt}](${src})${caption ? `\n\n${caption}` : ""}\n\n`;
      return caption ? `\n\n${caption}\n\n` : "";
    },
  });
  return service;
}

const service = createService();

export function absolutize(html: string, baseUrl: string): { html: string; document: Document } {
  const document = new DOMParser().parseFromString(html, "text/html") as unknown as Document;
  if (!document) return { html, document: new DOMParser().parseFromString("<html></html>", "text/html") as unknown as Document };

  const resolve = (value: string | null): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:")) return null;
    try {
      const url = new URL(trimmed, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  };

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = resolve(anchor.getAttribute("href"));
    if (href) anchor.setAttribute("href", href);
    else anchor.removeAttribute("href");
  }

  for (const image of Array.from(document.querySelectorAll("img"))) {
    const candidate =
      image.getAttribute("src") ??
      image.getAttribute("data-src") ??
      image.getAttribute("data-original") ??
      image.getAttribute("data-actualsrc");
    const src = resolve(candidate);
    if (src) image.setAttribute("src", src);
    else image.removeAttribute("src");
    const srcset = image.getAttribute("srcset");
    if (srcset) {
      const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      const resolved = resolve(first ?? null);
      if (resolved && !src) image.setAttribute("src", resolved);
      image.removeAttribute("srcset");
    }
    for (const lazy of ["data-src", "data-original", "data-actualsrc"]) image.removeAttribute(lazy);
    image.removeAttribute("loading");
  }

  for (const node of Array.from(document.querySelectorAll("script,style,noscript,template"))) {
    node.remove();
  }

  return { html: document.documentElement?.outerHTML ?? html, document };
}

export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
    .trim();
}

/** Convert an HTML fragment (already absolutized) to Markdown. */
export function htmlToMarkdown(html: string, baseUrl: string): string {
  if (!html.trim()) return "";
  let prepared = html;
  try {
    prepared = absolutize(`<html><body>${html}</body></html>`, baseUrl).document.body?.innerHTML ?? html;
  } catch {
    prepared = html;
  }
  return normalizeMarkdown(service.turndown(prepared));
}

/** Visible text length, used for the precision/recall comparison. */
export function visibleTextLength(markdownOrHtml: string): number {
  if (!markdownOrHtml) return 0;
  const text = markdownOrHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length;
}
