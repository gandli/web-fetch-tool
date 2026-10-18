-- Module 9 / acceptance #9: shared tool history is readable and writable by
-- anonymous and authenticated users. Tokens, bindings, sessions and rate
-- counters are server-side only.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;

-- Row level security is enabled on every table.
alter table fetch_history enable row level security;
alter table ai_results enable row level security;
alter table archive_records enable row level security;
alter table api_tokens enable row level security;
alter table telegram_bindings enable row level security;
alter table telegram_logs enable row level security;
alter table platform_sessions enable row level security;
alter table app_settings enable row level security;

-- Public business tables: anonymous + authenticated read/write.
grant select, insert, update on fetch_history to anon, authenticated;
grant select, insert, update on ai_results to anon, authenticated;
grant select, insert, update on archive_records to anon, authenticated;

drop policy if exists fetch_history_public_select on fetch_history;
create policy fetch_history_public_select on fetch_history
  for select to anon, authenticated using (true);

drop policy if exists fetch_history_public_insert on fetch_history;
create policy fetch_history_public_insert on fetch_history
  for insert to anon, authenticated with check (true);

drop policy if exists fetch_history_public_update on fetch_history;
create policy fetch_history_public_update on fetch_history
  for update to anon, authenticated using (true) with check (true);

drop policy if exists ai_results_public_select on ai_results;
create policy ai_results_public_select on ai_results
  for select to anon, authenticated using (true);

drop policy if exists ai_results_public_insert on ai_results;
create policy ai_results_public_insert on ai_results
  for insert to anon, authenticated with check (true);

drop policy if exists ai_results_public_update on ai_results;
create policy ai_results_public_update on ai_results
  for update to anon, authenticated using (true) with check (true);

drop policy if exists archive_records_public_select on archive_records;
create policy archive_records_public_select on archive_records
  for select to anon, authenticated using (true);

drop policy if exists archive_records_public_insert on archive_records;
create policy archive_records_public_insert on archive_records
  for insert to anon, authenticated with check (true);

drop policy if exists archive_records_public_update on archive_records;
create policy archive_records_public_update on archive_records
  for update to anon, authenticated using (true) with check (true);

-- Sensitive tables keep RLS on with no policies and no grants: anon and
-- authenticated cannot read or write them even if they know the table name.
revoke all on api_tokens, telegram_bindings, telegram_logs, platform_sessions, app_settings from anon, authenticated;
