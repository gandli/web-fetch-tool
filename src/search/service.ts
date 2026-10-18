import type { Db } from "../db/db.ts";
import { AppError } from "../contracts/errors.ts";
import { escapeLike, hasCjk, makeSnippet, normalizeQuery, queryTerms } from "./search-query.ts";

export type SearchSort = "relevance" | "recent";

export interface SearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  platform?: string | null;
  before?: string | null;
  sort?: SearchSort;
}

export interface SearchItem {
  id: string;
  url: string;
  title: string;
  platform: string;
  provider: string;
  snippet: string;
  score: number;
  content_length: number;
  created_at: string;
  og: Record<string, unknown>;
}

export interface SearchResult {
  query: string;
  mode: "fts" | "substring";
  fallback: boolean;
  total: number;
  items: SearchItem[];
  next_offset: number | null;
  took_ms: number;
}

interface SearchRow {
  id: string;
  url: string;
  title: string | null;
  platform: string;
  provider: string;
  og: Record<string, unknown> | null;
  content_length: number;
  created_at: Date | string;
  content_markdown: string | null;
  score: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: SearchRow, terms: string[]): SearchItem {
  const content = row.content_markdown ?? "";
  return {
    id: row.id,
    url: row.url,
    title: row.title ?? row.url,
    platform: row.platform,
    provider: row.provider,
    snippet: makeSnippet(content || row.title || "", terms),
    score: Number(row.score ?? 0),
    content_length: Number(row.content_length ?? 0),
    created_at: iso(row.created_at),
    og: row.og ?? {},
  };
}

const SELECT_COLUMNS = `f.id, f.url, f.title, f.platform, f.provider, f.og, f.content_length, f.created_at, f.content_markdown`;

async function ftsRows(
  db: Db,
  query: string,
  limit: number,
  offset: number,
  platform: string | null,
  before: string | null,
  sort: SearchSort,
): Promise<SearchRow[]> {
  const order = sort === "recent" ? "f.created_at desc, score desc" : "score desc, f.created_at desc";
  return db.query<SearchRow>(
    `select ${SELECT_COLUMNS},
            ts_rank_cd(f.search_vector, websearch_to_tsquery('simple', $1))::float8 as score
       from fetch_history f
      where f.search_vector @@ websearch_to_tsquery('simple', $1)
        and ($2::text is null or f.platform = $2)
        and ($3::timestamptz is null or f.created_at < $3)
      order by ${order}
      limit $4 offset $5`,
    [query, platform, before, limit, offset],
  );
}

async function ftsCount(db: Db, query: string, platform: string | null, before: string | null): Promise<number> {
  const rows = await db.query<{ total: number }>(
    `select (count(*))::int as total
       from fetch_history f
      where f.search_vector @@ websearch_to_tsquery('simple', $1)
        and ($2::text is null or f.platform = $2)
        and ($3::timestamptz is null or f.created_at < $3)`,
    [query, platform, before],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Substring path: used for CJK (no built-in segmenter), and as a fallback when
 * the lexical query matched nothing. LIKE wildcards are escaped, so the query
 * is always literal.
 */
async function substringRows(
  db: Db,
  query: string,
  limit: number,
  offset: number,
  platform: string | null,
  before: string | null,
  sort: SearchSort,
): Promise<SearchRow[]> {
  const pattern = `%${escapeLike(query)}%`;
  const order = sort === "recent" ? "f.created_at desc, score desc" : "score desc, f.created_at desc";
  return db.query<SearchRow>(
    `select ${SELECT_COLUMNS},
            (case
               when f.title ilike $1 escape '\\' then 1.0
               when f.url ilike $1 escape '\\' then 0.7
               when f.content_markdown ilike $1 escape '\\' then 0.5
               else 0.3
             end)::float8 as score
       from fetch_history f
      where (
              f.title ilike $1 escape '\\'
              or f.content_markdown ilike $1 escape '\\'
              or f.url ilike $1 escape '\\'
              or coalesce(f.metadata->>'author', '') ilike $1 escape '\\'
              or coalesce(f.og->>'site_name', '') ilike $1 escape '\\'
            )
        and ($2::text is null or f.platform = $2)
        and ($3::timestamptz is null or f.created_at < $3)
      order by ${order}
      limit $4 offset $5`,
    [pattern, platform, before, limit, offset],
  );
}

async function substringCount(db: Db, query: string, platform: string | null, before: string | null): Promise<number> {
  const pattern = `%${escapeLike(query)}%`;
  const rows = await db.query<{ total: number }>(
    `select (count(*))::int as total
       from fetch_history f
      where (
              f.title ilike $1 escape '\\'
              or f.content_markdown ilike $1 escape '\\'
              or f.url ilike $1 escape '\\'
              or coalesce(f.metadata->>'author', '') ilike $1 escape '\\'
              or coalesce(f.og->>'site_name', '') ilike $1 escape '\\'
            )
        and ($2::text is null or f.platform = $2)
        and ($3::timestamptz is null or f.created_at < $3)`,
    [pattern, platform, before],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Full-text search over shared history.
 *
 * Ranking: weighted tsvector (title A, body B, url C) with `ts_rank_cd`.
 * CJK has no dictionary in Postgres, so those queries use an escaped substring
 * match ordered by where the hit landed. Non-CJK queries that the lexical index
 * cannot match fall back to the same substring path instead of returning zero.
 */
export async function searchHistory(db: Db, options: SearchOptions): Promise<SearchResult> {
  const startedAt = Date.now();
  const query = normalizeQuery(options.query);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), 1000);
  const platform = options.platform?.trim() || null;
  const before = options.before?.trim() || null;
  const sort: SearchSort = options.sort === "recent" ? "recent" : "relevance";
  const terms = queryTerms(query);

  let mode: "fts" | "substring" = hasCjk(query) ? "substring" : "fts";
  let fallback = false;
  let rows: SearchRow[] = [];
  let total = 0;

  try {
    if (mode === "fts") {
      rows = await ftsRows(db, query, limit, offset, platform, before, sort);
      total = await ftsCount(db, query, platform, before);
      if (total === 0 && query.length >= 2) {
        mode = "substring";
        fallback = true;
      }
    }

    if (mode === "substring") {
      rows = await substringRows(db, query, limit, offset, platform, before, sort);
      total = await substringCount(db, query, platform, before);
    }
  } catch (error) {
    throw new AppError("internal", `search failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const nextOffset = rows.length === limit && offset + limit < total ? offset + limit : null;

  return {
    query,
    mode,
    fallback,
    total,
    items: rows.map((row) => mapRow(row, terms)),
    next_offset: nextOffset,
    took_ms: Date.now() - startedAt,
  };
}
