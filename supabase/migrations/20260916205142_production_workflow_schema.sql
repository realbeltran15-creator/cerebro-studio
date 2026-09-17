-- Cerebro Studio production workflow baseline
-- Documents the workflow tables already deployed to Supabase.

create table if not exists public.storyboards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text,
  status text not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storyboard_id uuid not null references public.storyboards(id) on delete cascade,
  position integer not null,
  script text,
  visual_prompt text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(storyboard_id, position)
);

create table if not exists public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued',
  idempotency_key text,
  input_manifest jsonb not null default '{}'::jsonb,
  output_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, idempotency_key)
);

create table if not exists public.connector_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  capability text not null,
  status text not null default 'disconnected',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, capability)
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  action_type text not null,
  action_key text not null,
  status text not null default 'pending',
  context jsonb not null default '{}'::jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique(owner_id, action_type, action_key)
);

alter table public.storyboards enable row level security;
alter table public.scenes enable row level security;
alter table public.render_jobs enable row level security;
alter table public.connector_configs enable row level security;
alter table public.approvals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='storyboards' and policyname='storyboards_owner_all') then
    create policy storyboards_owner_all on public.storyboards for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='scenes' and policyname='scenes_owner_all') then
    create policy scenes_owner_all on public.scenes for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='render_jobs' and policyname='render_jobs_owner_all') then
    create policy render_jobs_owner_all on public.render_jobs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connector_configs' and policyname='connector_configs_owner_all') then
    create policy connector_configs_owner_all on public.connector_configs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='approvals' and policyname='approvals_owner_all') then
    create policy approvals_owner_all on public.approvals for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
end $$;

create index if not exists storyboards_owner_project_idx on public.storyboards(owner_id, project_id);
create index if not exists scenes_owner_storyboard_idx on public.scenes(owner_id, storyboard_id);
create index if not exists render_jobs_owner_project_idx on public.render_jobs(owner_id, project_id);
create index if not exists approvals_owner_project_idx on public.approvals(owner_id, project_id);
