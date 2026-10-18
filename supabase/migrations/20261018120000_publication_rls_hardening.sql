-- PREPARED, NOT APPLIED. Requires explicit authorization from the owner before running against any shared database.
--
-- Publication hardening (second layer behind the server-side HMAC approval seal, lib/publication/seal.ts).
-- Before: approvals and publication_jobs had one `for all` owner policy, so the owner's browser session (or an XSS) could insert an
-- approved approval, mark a job «approved»/«published» or edit result fields without going through the server checks.
-- After:
--   * approvals: the browser can only READ its own rows. Approvals are written by the server with the service role.
--   * publication_jobs: the browser can read its rows, create drafts, edit drafts / jobs awaiting approval, and cancel
--     (also an approved job). Moving a job to approved / publishing / published and writing the publication result is server-only.
-- The app writes those transitions through lib/supabase/admin.ts (service role, every query filtered by the authenticated owner).
-- DEPLOY ORDER: 1) deploy the code that uses publicationWriter AND set SUPABASE_SERVICE_ROLE_KEY in that environment; 2) apply this file.
-- Rollback: supabase/rollback/20261018120000_publication_rls_hardening.down.sql
begin;

-- approvals ---------------------------------------------------------------
alter table public.approvals enable row level security;
drop policy if exists approvals_owner_all on public.approvals;
drop policy if exists approvals_owner_read on public.approvals;
create policy approvals_owner_read on public.approvals
  for select to authenticated using (owner_id = (select auth.uid()));

-- publication_jobs --------------------------------------------------------
alter table public.publication_jobs enable row level security;
drop policy if exists publication_jobs_owner_all on public.publication_jobs;
drop policy if exists publication_jobs_owner_read on public.publication_jobs;
drop policy if exists publication_jobs_owner_insert on public.publication_jobs;
drop policy if exists publication_jobs_owner_update on public.publication_jobs;
drop policy if exists publication_jobs_owner_delete on public.publication_jobs;

create policy publication_jobs_owner_read on public.publication_jobs
  for select to authenticated using (owner_id = (select auth.uid()));

-- New jobs start as a draft (or directly awaiting approval). Never approved/published from the browser.
create policy publication_jobs_owner_insert on public.publication_jobs
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and status in ('draft', 'awaiting_approval'));

-- Editable while not yet approved; an approved (not yet publishing) job may only be sent back to draft or cancelled.
create policy publication_jobs_owner_update on public.publication_jobs
  for update to authenticated
  using (owner_id = (select auth.uid()) and status in ('draft', 'awaiting_approval', 'approved'))
  with check (owner_id = (select auth.uid()) and status in ('draft', 'awaiting_approval', 'cancelled'));

-- Deleting is allowed only for jobs that never reached a platform.
create policy publication_jobs_owner_delete on public.publication_jobs
  for delete to authenticated
  using (owner_id = (select auth.uid()) and status in ('draft', 'awaiting_approval', 'cancelled'));

commit;
