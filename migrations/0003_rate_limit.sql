-- Atomic, database-backed rate limiting (works across serverless instances).
create table if not exists rate_limit_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

create or replace function bump_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns jsonb
language sql
as $$
  with upserted as (
    insert into rate_limit_counters as r (key, window_start, count)
    values (p_key, now(), 1)
    on conflict (key) do update set
      count = case
        when r.window_start + make_interval(secs => p_window_seconds) <= now() then 1
        else r.count + 1
      end,
      window_start = case
        when r.window_start + make_interval(secs => p_window_seconds) <= now() then now()
        else r.window_start
      end
    returning r.count, r.window_start
  )
  select jsonb_build_object(
    'allowed', count <= p_limit,
    'count', count,
    'limit', p_limit,
    'reset_at', (window_start + make_interval(secs => p_window_seconds))
  )
  from upserted;
$$;

alter table rate_limit_counters enable row level security;
revoke all on rate_limit_counters from anon, authenticated;
revoke all on function bump_rate_limit(text, integer, integer) from public;
