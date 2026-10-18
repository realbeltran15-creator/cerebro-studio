-- Rollback of 20261018120000_publication_rls_hardening.sql: restores the original single owner policies (`for all`).
begin;
drop policy if exists approvals_owner_read on public.approvals;
drop policy if exists approvals_owner_all on public.approvals;
create policy approvals_owner_all on public.approvals for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists publication_jobs_owner_read on public.publication_jobs;
drop policy if exists publication_jobs_owner_insert on public.publication_jobs;
drop policy if exists publication_jobs_owner_update on public.publication_jobs;
drop policy if exists publication_jobs_owner_delete on public.publication_jobs;
drop policy if exists publication_jobs_owner_all on public.publication_jobs;
create policy publication_jobs_owner_all on public.publication_jobs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
commit;
