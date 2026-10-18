import { DOMParser } from "linkedom";
import { Readability } from "@mozilla/readability";
import { extractImages } from "./images.ts";
import { htmlToMarkdown, normalizeMarkdown, visibleTextLength } from "./markdown.ts";
import { detectLanguage } from "./language.ts";
import type { ExtractorOutput } from "./precision.ts";

/** Recall-oriented extractor: Mozilla Readability over linkedom. */
export function recallExtract(html: string, url: string): ExtractorOutput | null {
  try {
    const document = new DOMParser().parseFromString(html, "text/html") as unknown as Document;
    if (!document) return null;
    const reader = new Readability(document as unknown as Document, { charThreshold: 0 });
    const article = reader.parse();
    if (!article) return null;

    const markdown = normalizeMarkdown(htmlToMarkdown(article.content ?? "", url));
    if (!markdown) return null;

    const contentDocument = new DOMParser().parseFromString(article.content ?? "", "text/html") as unknown as Document;
    const text = (article.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      markdown,
      text,
      title: article.title?.trim() || null,
      author: article.byline?.trim() || null,
      publishedAt: article.publishedTime?.trim() || null,
      language: detectLanguage(text, article.lang ?? null),
      images: extractImages(contentDocument, url),
      extractor: "readability",
      length: visibleTextLength(text || markdown),
      notes: ["recall via readability"],
    };
  } catch {
    return null;
  }
}
