-- Full-text search over shared history.
-- `simple` configuration keeps the index language-agnostic (no English stemming
-- surprises for mixed content). CJK queries use the substring path instead,
-- because Postgres has no built-in Chinese word segmenter.
alter table fetch_history
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content_markdown, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(url, '')), 'C')
  ) stored;

create index if not exists fetch_history_search_idx on fetch_history using gin (search_vector);

-- Helps the substring/CJK path once the table grows; harmless on small data.
create index if not exists fetch_history_platform_created_idx on fetch_history (platform, created_at desc);
create index if not exists fetch_history_created_at_id_idx on fetch_history (created_at desc, id);
