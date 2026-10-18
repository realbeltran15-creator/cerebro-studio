-- Rollback of 20261018120000_server_owned_security.sql: restores the previous live policies (*_own, `for all`) and table grants.
begin;
drop policy if exists approvals_owner_read on public.approvals;
drop policy if exists approvals_own on public.approvals;
create policy approvals_own on public.approvals for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists publication_jobs_owner_read on public.publication_jobs;
drop policy if exists publication_jobs_owner_insert on public.publication_jobs;
drop policy if exists publication_jobs_owner_update on public.publication_jobs;
drop policy if exists publication_jobs_owner_delete on public.publication_jobs;
drop policy if exists publication_jobs_own on public.publication_jobs;
create policy publication_jobs_own on public.publication_jobs for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists channel_connections_owner_read on public.channel_connections;
drop policy if exists connections_own on public.channel_connections;
create policy connections_own on public.channel_connections for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant all on public.channel_connections to anon, authenticated;

drop index if exists public.automation_runs_one_running_idx;
-- The spend ledger is kept (it only adds protection and holds history). To remove it as well:
-- drop table if exists public.generation_spend;
commit;
