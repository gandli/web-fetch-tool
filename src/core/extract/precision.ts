import { DOMParser } from "linkedom";
import { Defuddle } from "defuddle/node";
import { fetchJson } from "../fetch/http.ts";
import { extractImages } from "./images.ts";
import { htmlToMarkdown, normalizeMarkdown, visibleTextLength } from "./markdown.ts";
import { detectLanguage } from "./language.ts";

export interface ExtractorOutput {
  markdown: string;
  text: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  language: string | null;
  images: string[];
  extractor: "trafilatura" | "defuddle" | "readability" | "native" | "jina";
  length: number;
  notes: string[];
}

export interface PrecisionOptions {
  trafilaturaUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface TrafilaturaResponse {
  markdown?: string;
  content?: string;
  text?: string;
  title?: string;
  author?: string;
  date?: string;
  published_at?: string;
  language?: string;
  images?: string[];
}

async function viaTrafilatura(html: string, url: string, options: PrecisionOptions): Promise<ExtractorOutput | null> {
  if (!options.trafilaturaUrl) return null;
  try {
    const { data } = await fetchJson<TrafilaturaResponse>(options.trafilaturaUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, html }),
      timeoutMs: options.timeoutMs ?? 12000,
      fetchImpl: options.fetchImpl,
      maxBytes: 4 * 1024 * 1024,
    });
    const markdown = normalizeMarkdown(data.markdown ?? (data.content ? htmlToMarkdown(data.content, url) : data.text ?? ""));
    if (!markdown) return null;
    const document = new DOMParser().parseFromString(data.content ?? "", "text/html") as unknown as Document;
    return {
      markdown,
      text: markdown,
      title: data.title?.trim() || null,
      author: data.author?.trim() || null,
      publishedAt: (data.date ?? data.published_at)?.trim() || null,
      language: detectLanguage(markdown, data.language ?? null),
      images: data.images?.length ? data.images : extractImages(document, url),
      extractor: "trafilatura",
      length: visibleTextLength(markdown),
      notes: ["precision via trafilatura sidecar"],
    };
  } catch {
    return null;
  }
}

async function viaDefuddle(html: string, url: string): Promise<ExtractorOutput | null> {
  try {
    const result = await Defuddle(html, url, { markdown: true, useAsync: false });
    const markdown = normalizeMarkdown(
      result.contentMarkdown ?? (result.content ? htmlToMarkdown(result.content, url) : ""),
    );
    if (!markdown) return null;
    const document = new DOMParser().parseFromString(result.content ?? "", "text/html") as unknown as Document;
    return {
      markdown,
      text: markdown,
      title: result.title?.trim() || null,
      author: result.author?.trim() || null,
      publishedAt: result.published?.trim() || null,
      language: detectLanguage(markdown, result.language ?? null),
      images: extractImages(document, url),
      extractor: "defuddle",
      length: visibleTextLength(markdown),
      notes: ["precision via defuddle"],
    };
  } catch {
    return null;
  }
}

/** Precision-oriented extractor: real Trafilatura sidecar when configured, else defuddle. */
export async function precisionExtract(
  html: string,
  url: string,
  options: PrecisionOptions = {},
): Promise<ExtractorOutput | null> {
  const trafilatura = await viaTrafilatura(html, url, options);
  if (trafilatura) return trafilatura;
  const defuddle = await viaDefuddle(html, url);
  if (defuddle && options.trafilaturaUrl) {
    defuddle.notes.push("trafilatura sidecar unavailable, fell back to defuddle");
  }
  return defuddle;
}
