import { AppError } from "../../contracts/errors.ts";
import type { ExtractedContent, OgInfo } from "../../contracts/types.ts";
import { precisionExtract, type ExtractorOutput, type PrecisionOptions } from "./precision.ts";
import { recallExtract } from "./recall.ts";
import { detectLanguage } from "./language.ts";

export interface ExtractArticleOptions extends PrecisionOptions {
  og?: OgInfo;
  maxChars?: number;
  /** Test seam: swap extractors without touching the cascade rules. */
  extractors?: {
    precision?: typeof precisionExtract;
    recall?: typeof recallExtract;
  };
}

function truncate(markdown: string, maxChars?: number): string {
  if (!maxChars || markdown.length <= maxChars) return markdown;
  return `${markdown.slice(0, maxChars)}\n\n> 内容过长，已截断。`;
}

/**
 * Multi-extractor cascade:
 *   - run precision and recall in parallel;
 *   - fall back to recall when precision keeps less than 60% of recall text;
 *   - prefer precision otherwise;
 *   - merge non-empty metadata and record the difference in debug notes.
 */
export async function extractArticle(
  html: string,
  url: string,
  options: ExtractArticleOptions = {},
): Promise<ExtractedContent> {
  const [precision, recall] = await Promise.all([
    (options.extractors?.precision ?? precisionExtract)(html, url, options).catch(() => null),
    Promise.resolve().then(() => (options.extractors?.recall ?? recallExtract)(html, url)),
  ]);

  if (!precision && !recall) {
    throw new AppError("content_empty", `no extractor produced content for ${url}`);
  }

  const notes: string[] = [];
  let chosen: ExtractorOutput;
  const precisionLength = precision?.length ?? 0;
  const recallLength = recall?.length ?? 0;

  if (precision && recall) {
    if (precisionLength < recallLength * 0.6) {
      chosen = recall;
      notes.push(`precision ${precisionLength} < recall ${recallLength} * 0.6, used recall`);
    } else {
      chosen = precision;
      notes.push(`precision ${precisionLength} >= recall ${recallLength} * 0.6, used precision`);
    }
  } else {
    chosen = (precision ?? recall)!;
    notes.push(precision ? "recall failed, used precision" : "precision failed, used recall");
  }

  const other = chosen === precision ? recall : precision;
  notes.push(...(precision?.notes ?? []), ...(recall?.notes ?? []));
  if (chosen.extractor !== other?.extractor && other?.extractor) {
    notes.push(`extractors differed: ${chosen.extractor} vs ${other.extractor}`);
  }

  const markdown = truncate(chosen.markdown, options.maxChars);
  const og = options.og;
  const merged = {
    title: chosen.title || other?.title || og?.title || null,
    author: chosen.author || other?.author || null,
    publishedAt: chosen.publishedAt || other?.publishedAt || null,
    language: chosen.language || other?.language || detectLanguage(markdown),
    images: chosen.images.length ? chosen.images : other?.images ?? [],
    siteName: og?.site_name ?? null,
  };

  return {
    markdown,
    text: chosen.text || markdown,
    title: merged.title,
    author: merged.author,
    publishedAt: merged.publishedAt,
    language: merged.language,
    images: merged.images,
    siteName: merged.siteName,
    extractor: chosen.extractor,
    debug: {
      precision_length: precisionLength,
      recall_length: recallLength,
      chosen: chosen.extractor,
      notes,
    },
  };
}
