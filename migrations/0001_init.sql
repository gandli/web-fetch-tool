-- Module 9: core tables.
create table if not exists fetch_history (
  id uuid primary key,
  url text not null,
  normalized_url text not null,
  platform text not null,
  engine text not null default 'auto',
  provider text not null,
  title text,
  content_markdown text,
  content_length integer not null default 0,
  raw_html text,
  metadata jsonb not null default '{}'::jsonb,
  og jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  status text not null default 'ok',
  error_code text,
  fetch_attempts jsonb not null default '[]'::jsonb,
  extract_debug jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_results (
  id uuid primary key,
  fetch_id uuid not null references fetch_history(id) on delete cascade,
  kind text not null,
  target_language text,
  model text,
  content jsonb not null,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists archive_records (
  id uuid primary key,
  fetch_id uuid not null references fetch_history(id) on delete cascade,
  channel text not null,
  status text not null,
  url text,
  external_id text,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists api_tokens (
  id uuid primary key,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default '{}',
  enabled boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists telegram_bindings (
  id uuid primary key,
  chat_id bigint not null unique,
  title text,
  settings jsonb not null default '{"lang":"zh","translate":false,"archive":true,"summary_length":"medium"}'::jsonb,
  active boolean not null default true,
  bound_at timestamptz not null default now()
);

create table if not exists telegram_logs (
  id uuid primary key,
  chat_id bigint,
  update_id bigint not null unique,
  url text,
  fetch_id uuid references fetch_history(id) on delete set null,
  status text not null default 'pending',
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Only reachable through the server role; never exposed through the public API.
create table if not exists platform_sessions (
  id uuid primary key,
  platform text not null unique,
  secret_encrypted text not null,
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists fetch_history_created_at_idx on fetch_history (created_at desc);
create index if not exists fetch_history_platform_idx on fetch_history (platform);
create index if not exists ai_results_fetch_id_idx on ai_results (fetch_id);
create index if not exists archive_records_fetch_id_idx on archive_records (fetch_id);
create index if not exists telegram_logs_chat_idx on telegram_logs (chat_id, created_at desc);
create index if not exists api_tokens_prefix_idx on api_tokens (token_prefix);
