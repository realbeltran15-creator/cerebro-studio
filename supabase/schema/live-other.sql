-- Indexes, functions, triggers, RLS policies, storage bucket/policies of Production (structure only, read from the catalog 2026-11-01).
create index if not exists approvals_owner_status_idx on public.approvals (owner_id, status);
create index if not exists assets_owner_project_idx on public.assets (owner_id, project_id);
create index if not exists assets_project_id_idx on public.assets (project_id);
create index if not exists audit_log_actor_id_idx on public.audit_log (actor_id);
create index if not exists audit_log_owner_created_idx on public.audit_log (owner_id, created_at desc);
create index if not exists automation_runs_automation_idx on public.automation_runs (automation_id, started_at desc);
create index if not exists automation_runs_owner_idx on public.automation_runs (owner_id);
create unique index if not exists automation_runs_one_running_idx on public.automation_runs (automation_id) where status = 'running';
create index if not exists automations_due_idx on public.automations (schedule, enabled, last_run_at);
create index if not exists automations_owner_idx on public.automations (owner_id);
create index if not exists campaigns_owner_updated_idx on public.campaigns (owner_id, updated_at desc);
create index if not exists campaigns_project_idx on public.campaigns (project_id) where project_id is not null;
create index if not exists generation_spend_owner_created_idx on public.generation_spend (owner_id, created_at desc);
create index if not exists metric_snapshots_lookup_idx on public.metric_snapshots (owner_id, platform, external_content_id, metric_date desc);
create index if not exists metric_snapshots_project_id_idx on public.metric_snapshots (project_id);
create index if not exists opportunities_owner_status_idx on public.opportunities (owner_id, status);
create index if not exists opportunities_project_id_idx on public.opportunities (project_id);
create unique index if not exists opportunities_owner_source_unique on public.opportunities (owner_id, source_platform, source_id) where source_id is not null;
create index if not exists projects_owner_idx on public.projects (owner_id);
create index if not exists publication_jobs_approved_by_idx on public.publication_jobs (approved_by);
create index if not exists publication_jobs_owner_status_idx on public.publication_jobs (owner_id, status);
create index if not exists publication_jobs_project_id_idx on public.publication_jobs (project_id);
create index if not exists render_jobs_output_asset_id_idx on public.render_jobs (output_asset_id);
create index if not exists render_jobs_owner_id_idx on public.render_jobs (owner_id);
create index if not exists render_jobs_project_id_idx on public.render_jobs (project_id);
create index if not exists research_cache_owner_fetched_idx on public.research_cache (owner_id, fetched_at desc);
create index if not exists scenes_owner_id_idx on public.scenes (owner_id);
create index if not exists scenes_storyboard_position_idx on public.scenes (storyboard_id, "position");
create index if not exists scripts_owner_project_idx on public.scripts (owner_id, project_id);
create index if not exists scripts_parent_idx on public.scripts (parent_id);
create index if not exists scripts_source_opportunity_idx on public.scripts (source_opportunity_id);
create index if not exists shorts_factory_owner_status_idx on public.shorts_factory_items (owner_id, status, created_at desc);
create unique index if not exists shorts_factory_one_per_day on public.shorts_factory_items (owner_id, prepared_on) where status <> all (array['discarded'::text, 'failed'::text]);
create index if not exists storyboards_owner_id_idx on public.storyboards (owner_id);
create index if not exists storyboards_project_id_idx on public.storyboards (project_id);
create index if not exists storyboards_script_idx on public.storyboards (script_id);
create index if not exists trend_snapshots_lookup_idx on public.trend_snapshots (owner_id, region, category_id, fetched_at desc);
create index if not exists vi_generation_jobs_persona_idx on public.vi_generation_jobs (persona_id, created_at desc);
create index if not exists vi_identity_versions_persona_idx on public.vi_identity_versions (persona_id, version desc);
create index if not exists vi_personas_owner_idx on public.vi_personas (owner_id);
create index if not exists vi_quality_reports_persona_idx on public.vi_quality_reports (persona_id);
create index if not exists vi_references_persona_idx on public.vi_references (persona_id, category);
create index if not exists vi_scenes_persona_idx on public.vi_scenes (persona_id);
create index if not exists vi_voice_profiles_persona_idx on public.vi_voice_profiles (persona_id);
create index if not exists vi_wardrobe_persona_idx on public.vi_wardrobe (persona_id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email));
  return new;
end;
$$;
create or replace function public.research_lock(p_key text, p_ttl_seconds integer) returns boolean language plpgsql as $$
declare uid uuid := (select auth.uid()); got uuid;
begin
  if uid is null then return false; end if;
  insert into public.research_cache (owner_id, cache_key, kind, payload, units, fetched_at, expires_at)
  values (uid, p_key, 'lock', '{}'::jsonb, 0, now(), now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  on conflict (owner_id, cache_key) do update set kind = 'lock', fetched_at = now(), expires_at = excluded.expires_at
    where public.research_cache.expires_at <= now()
  returning id into got;
  return got is not null;
end $$;
create or replace function public.research_quota_day_start() returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'
$$;
create or replace function public.research_reserve(p_key text, p_units integer, p_cap integer, p_ttl_seconds integer, p_searches integer default 0, p_search_cap integer default 1000000) returns jsonb language plpgsql as $$
declare uid uuid := (select auth.uid()); used integer; used_s integer;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'no_session', 'used', 0, 'used_searches', 0); end if;
  if p_units < 0 or p_cap < 0 or p_searches < 0 or p_search_cap < 0 then raise exception 'invalid budget'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research_reserve:' || uid::text, 0));
  select coalesce(sum(units), 0), coalesce(sum(searches), 0) into used, used_s from public.research_cache where owner_id = uid and fetched_at >= public.research_quota_day_start();
  if used + p_units > p_cap then return jsonb_build_object('ok', false, 'reason', 'budget', 'used', used, 'used_searches', used_s); end if;
  if used_s + p_searches > p_search_cap then return jsonb_build_object('ok', false, 'reason', 'search_budget', 'used', used, 'used_searches', used_s); end if;
  insert into public.research_cache (owner_id, cache_key, kind, payload, units, searches, fetched_at, expires_at)
  values (uid, p_key, 'reserve', '{}'::jsonb, p_units, p_searches, now(), now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  on conflict (owner_id, cache_key) do update set kind = 'reserve', units = excluded.units, searches = excluded.searches, fetched_at = now(), expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'used', used + p_units, 'used_searches', used_s + p_searches);
end $$;
create or replace function public.vi_check_ownership() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_table_name = 'vi_personas' then
    if not exists (select 1 from public.projects where id = new.project_id and owner_id = new.owner_id) then
      raise exception 'Project does not belong to the persona owner.';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.vi_personas where id = new.persona_id and owner_id = new.owner_id) then
    raise exception 'Persona does not belong to this owner.';
  end if;
  if tg_table_name = 'vi_references' then
    if not exists (select 1 from public.assets where id = new.asset_id and owner_id = new.owner_id) then
      raise exception 'Asset does not belong to this owner.';
    end if;
  elsif tg_table_name = 'vi_generation_jobs' then
    if new.output_asset_id is not null then
      if not exists (select 1 from public.assets where id = new.output_asset_id and owner_id = new.owner_id) then
        raise exception 'Output asset does not belong to this owner.';
      end if;
    end if;
  end if;
  return new;
end $$;
create or replace function public.vi_identity_versions_lock() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if old.status in ('approved', 'superseded') then
    if new.traits is distinct from old.traits or new.reference_asset_ids is distinct from old.reference_asset_ids
       or new.version is distinct from old.version or new.persona_id is distinct from old.persona_id
       or (old.status = 'superseded' and new.status <> 'superseded')
       or (old.status = 'approved' and new.status not in ('approved', 'superseded')) then
      raise exception 'Approved identity versions are immutable; create a new version instead.';
    end if;
  end if;
  return new;
end $$;
-- Function privileges as in Production (default PUBLIC execute is revoked, then granted explicitly).
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.vi_check_ownership() from public, anon, authenticated;
revoke all on function public.vi_identity_versions_lock() from public, anon, authenticated;
revoke all on function public.research_lock(text, integer) from public, anon;
revoke all on function public.research_reserve(text, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.handle_new_user(), public.vi_check_ownership(), public.vi_identity_versions_lock() to service_role;
grant execute on function public.research_lock(text, integer), public.research_reserve(text, integer, integer, integer, integer, integer) to authenticated, service_role;
grant execute on function public.research_quota_day_start() to public, anon, authenticated, service_role;

create trigger vi_generation_jobs_ownership before insert or update on public.vi_generation_jobs for each row execute function public.vi_check_ownership();
create trigger vi_identity_versions_lock before update on public.vi_identity_versions for each row execute function public.vi_identity_versions_lock();
create trigger vi_identity_versions_ownership before insert or update on public.vi_identity_versions for each row execute function public.vi_check_ownership();
create trigger vi_personas_ownership before insert or update on public.vi_personas for each row execute function public.vi_check_ownership();
create trigger vi_quality_reports_ownership before insert or update on public.vi_quality_reports for each row execute function public.vi_check_ownership();
create trigger vi_references_ownership before insert or update on public.vi_references for each row execute function public.vi_check_ownership();
create trigger vi_scenes_ownership before insert or update on public.vi_scenes for each row execute function public.vi_check_ownership();
create trigger vi_voice_profiles_ownership before insert or update on public.vi_voice_profiles for each row execute function public.vi_check_ownership();
create trigger vi_wardrobe_ownership before insert or update on public.vi_wardrobe for each row execute function public.vi_check_ownership();
-- NOT reproduced here: the auth.users trigger that calls handle_new_user() lives in the auth schema (managed by Supabase).

-- RLS policies. Owner-only "for all" policies:
do $$ declare r record; begin
  for r in select * from (values
    ('profiles','profiles_own','public','id'),('projects','projects_own','public','owner_id'),('assets','assets_own','public','owner_id'),
    ('opportunities','opportunities_own','public','owner_id'),('metric_snapshots','metrics_own','public','owner_id'),
    ('storyboards','storyboards_own','public','owner_id'),('scenes','scenes_own','public','owner_id'),('render_jobs','render_jobs_own','public','owner_id'),
    ('connector_configs','connector_configs_own','public','owner_id'),('scripts','scripts_owner_all','public','owner_id'),
    ('trend_snapshots','trend_snapshots_owner_all','public','owner_id'),('automations','automations_owner_all','public','owner_id'),
    ('automation_runs','automation_runs_owner_all','public','owner_id'),('shorts_factory_items','shorts_factory_items_owner_all','public','owner_id'),
    ('research_cache','research_cache_owner_all','authenticated','owner_id')) as v(t,p,ro,c)
  loop execute format('create policy %I on public.%I for all to %s using (%I = (select auth.uid())) with check (%I = (select auth.uid()))', r.p, r.t, r.ro, r.c, r.c); end loop;
  for r in select unnest(array['vi_personas','vi_identity_versions','vi_references','vi_voice_profiles','vi_scenes','vi_wardrobe','vi_generation_jobs','vi_quality_reports']) t
  loop execute format('create policy %I on public.%I for all to public using (owner_id = auth.uid()) with check (owner_id = auth.uid())', r.t||'_owner_all', r.t); end loop;
end $$;
create policy audit_log_read_own on public.audit_log for select to public using (owner_id = (select auth.uid()));
create policy approvals_owner_read on public.approvals for select to authenticated using (owner_id = (select auth.uid()));
create policy channel_connections_owner_read on public.channel_connections for select to authenticated using (owner_id = (select auth.uid()));
create policy generation_spend_owner_read on public.generation_spend for select to authenticated using (owner_id = (select auth.uid()));
create policy publication_jobs_owner_read on public.publication_jobs for select to authenticated using (owner_id = (select auth.uid()));
create policy publication_jobs_owner_insert on public.publication_jobs for insert to authenticated with check (owner_id = (select auth.uid()) and status = any (array['draft'::text, 'awaiting_approval'::text]));
create policy publication_jobs_owner_update on public.publication_jobs for update to authenticated using (owner_id = (select auth.uid()) and status = any (array['draft'::text, 'awaiting_approval'::text, 'approved'::text])) with check (owner_id = (select auth.uid()) and status = any (array['draft'::text, 'awaiting_approval'::text, 'cancelled'::text]));
create policy publication_jobs_owner_delete on public.publication_jobs for delete to authenticated using (owner_id = (select auth.uid()) and status = any (array['draft'::text, 'awaiting_approval'::text, 'cancelled'::text]));
create policy campaigns_owner_all on public.campaigns for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (project_id is null or exists (select 1 from public.projects p where p.id = campaigns.project_id and p.owner_id = (select auth.uid()))));

-- Storage: private bucket "generated-assets"; each user only touches objects under a folder named with their own uid.
insert into storage.buckets (id, name, public) values ('generated-assets', 'generated-assets', false) on conflict (id) do nothing;
create policy "generated assets select own" on storage.objects for select to authenticated using (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "generated assets insert own" on storage.objects for insert to authenticated with check (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "generated assets update own" on storage.objects for update to authenticated using (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = (auth.uid())::text) with check (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "generated assets delete own" on storage.objects for delete to authenticated using (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = (auth.uid())::text);

-- Table privileges (Production starts from Supabase default grants to anon/authenticated/service_role, then restricts these):
revoke all on public.campaigns, public.channel_connections, public.generation_spend, public.research_cache from anon;
revoke all on public.channel_connections from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.generation_spend from authenticated;
