-- Read-only check after applying 20261013120000_research_cache, 20261015120000_campaigns and 20261018120000_server_owned_security.
-- Every column must be true. Modifies nothing.
select
  to_regclass('public.research_cache') is not null                                                        as research_cache_exists,
  to_regclass('public.campaigns') is not null                                                             as campaigns_exists,
  to_regclass('public.generation_spend') is not null                                                      as generation_spend_exists,
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.research_cache'::regclass, 'public.campaigns'::regclass, 'public.generation_spend'::regclass)) as rls_enabled,
  not exists (select 1 from pg_policies where schemaname = 'public' and policyname in ('approvals_own', 'publication_jobs_own', 'connections_own')) as old_for_all_policies_gone,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'approvals' and cmd = 'SELECT')        as approvals_read_only,
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'approvals' and cmd <> 'SELECT')    as approvals_no_browser_writes,
  not has_column_privilege('authenticated', 'public.channel_connections', 'token_ciphertext', 'SELECT')                as tokens_hidden_from_browser,
  not has_table_privilege('authenticated', 'public.channel_connections', 'INSERT')                                    as connections_no_browser_insert,
  has_column_privilege('authenticated', 'public.channel_connections', 'external_account_name', 'SELECT')               as connections_safe_columns_readable,
  not has_table_privilege('authenticated', 'public.generation_spend', 'INSERT')                                       as spend_ledger_server_only,
  to_regclass('public.automation_runs_one_running_idx') is not null                                                  as one_running_run_index,
  (select count(*) from public.channel_connections) = 2                                                             as connections_rows_unchanged;
