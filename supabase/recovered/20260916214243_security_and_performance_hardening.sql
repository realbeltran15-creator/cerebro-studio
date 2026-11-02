revoke execute on function public.handle_new_user() from public, anon, authenticated;

create index if not exists assets_project_id_idx on public.assets(project_id);
create index if not exists audit_log_actor_id_idx on public.audit_log(actor_id);
create index if not exists metric_snapshots_project_id_idx on public.metric_snapshots(project_id);
create index if not exists opportunities_project_id_idx on public.opportunities(project_id);
create index if not exists publication_jobs_approved_by_idx on public.publication_jobs(approved_by);
create index if not exists publication_jobs_project_id_idx on public.publication_jobs(project_id);
create index if not exists render_jobs_output_asset_id_idx on public.render_jobs(output_asset_id);
create index if not exists render_jobs_owner_id_idx on public.render_jobs(owner_id);
create index if not exists render_jobs_project_id_idx on public.render_jobs(project_id);
create index if not exists scenes_owner_id_idx on public.scenes(owner_id);
create index if not exists storyboards_owner_id_idx on public.storyboards(owner_id);
create index if not exists storyboards_project_id_idx on public.storyboards(project_id);

alter policy profiles_own on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy projects_own on public.projects using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy assets_own on public.assets using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy opportunities_own on public.opportunities using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy connections_own on public.channel_connections using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy metrics_own on public.metric_snapshots using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy publication_jobs_own on public.publication_jobs using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy audit_log_read_own on public.audit_log using (owner_id = (select auth.uid()));
alter policy storyboards_own on public.storyboards using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy scenes_own on public.scenes using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy render_jobs_own on public.render_jobs using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy connector_configs_own on public.connector_configs using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy approvals_own on public.approvals using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
