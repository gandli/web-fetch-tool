import { AppError } from "../contracts/errors.ts";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const MAX_QUERY = 200;

export function hasCjk(value: string): boolean {
  return CJK.test(value);
}

export function normalizeQuery(raw: string): string {
  if (typeof raw !== "string") throw new AppError("invalid_body", "query must be a string");
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new AppError("invalid_body", "query is empty");
  if (trimmed.length > MAX_QUERY) throw new AppError("invalid_body", `query exceeds ${MAX_QUERY} chars`);
  return trimmed;
}

/** Escape LIKE wildcards so a user query is always treated literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Words used for client-side highlighting and snippet centering. */
export function queryTerms(query: string): string[] {
  if (hasCjk(query)) return [query];
  const terms = query
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  return terms.length ? [...new Set(terms)] : [query];
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[>*_~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a readable snippet around the first query occurrence. Returns plain
 * text (no HTML); consumers highlight it themselves.
 */
export function makeSnippet(text: string, terms: string[], maxLength = 220): string {
  const plain = stripMarkdown(text ?? "");
  if (!plain) return "";
  const lower = plain.toLowerCase();

  let index = -1;
  let matchedLength = 0;
  for (const term of terms) {
    const candidate = term.toLowerCase();
    if (!candidate) continue;
    const found = lower.indexOf(candidate);
    if (found >= 0 && (index < 0 || found < index)) {
      index = found;
      matchedLength = candidate.length;
    }
  }

  if (index < 0) {
    return plain.length > maxLength ? `${plain.slice(0, maxLength).trimEnd()}…` : plain;
  }

  const context = Math.max(40, Math.floor((maxLength - matchedLength) / 2));
  const start = Math.max(0, index - context);
  const end = Math.min(plain.length, index + matchedLength + context);
  const body = plain.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < plain.length ? "…" : ""}`;
}
