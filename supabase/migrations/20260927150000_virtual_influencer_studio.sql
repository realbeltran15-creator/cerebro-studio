-- Virtual Influencer Studio (private module). Additive only.
-- Reuses projects (each persona owns a project so references live in the Biblioteca), assets,
-- approvals (human approval records) and the owner-scoped RLS model of the rest of the schema.

create table if not exists public.vi_personas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  handle text check (handle is null or handle ~ '^[a-z0-9_.]{2,40}$'),
  status text not null default 'draft' check (status in ('draft', 'identity_review', 'approved', 'archived')),
  -- Persona Bible: identity, personality, voice, values, content pillars, limits, disclosure.
  bible jsonb not null default '{}'::jsonb,
  current_identity_version integer,
  budget_eur numeric(10, 2) not null default 0 check (budget_eur >= 0),
  spent_eur numeric(10, 2) not null default 0 check (spent_eur >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Identity versions are immutable once approved: a change creates a new version.
create table if not exists public.vi_identity_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.vi_personas(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  -- Face, eyes, hair and hairline, skin, body proportions, hands, teeth, distinctive marks.
  traits jsonb not null default '{}'::jsonb,
  reference_asset_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (persona_id, version)
);

create table if not exists public.vi_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.vi_personas(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  category text not null check (category in ('face_front', 'face_profile', 'face_three_quarter', 'expression', 'body', 'hands', 'teeth', 'hair', 'wardrobe', 'environment', 'voice_sample', 'other')),
  approved boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (persona_id, asset_id, category)
);

create table if not exists public.vi_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.vi_personas(id) on delete cascade,
  name text not null,
  provider text,
  provider_voice_id text,
  -- Language, accent, pitch, pace, energy, emotional range, pronunciation notes.
  settings jsonb not null default '{}'::jsonb,
  sample_asset_ids uuid[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Scene Bible: recurring locations with geometry, lighting and camera notes.
create table if not exists public.vi_scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.vi_personas(id) on delete cascade,
  name text not null,
  description text,
  environment jsonb not null default '{}'::jsonb,
  reference_asset_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vi_wardrobe (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.vi_personas(id) on delete cascade,
  name text not null,
  category text not null default 'outfit' check (category in ('outfit', 'accessory', 'footwear', 'hair_style', 'makeup')),
  description text,
  details jsonb not null default '{}'::jsonb,
  reference_asset_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vi_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.vi_personas(id) on delete cascade,
  identity_version integer,
  kind text not null check (kind in ('image', 'video', 'voice', 'lipsync', 'upscale')),
  provider text not null,
  status text not null default 'draft' check (status in ('draft', 'blocked', 'queued', 'running', 'needs_review', 'approved', 'rejected', 'failed')),
  blocked_reasons text[] not null default '{}',
  prompt text,
  -- scene_id, wardrobe_ids, voice_profile_id, reference asset ids, script text…
  inputs jsonb not null default '{}'::jsonb,
  estimated_cost_eur numeric(10, 4),
  actual_cost_eur numeric(10, 4),
  cost_reported boolean not null default false,
  output_asset_id uuid references public.assets(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Quality reports never contain simulated scores: each check records how it was measured.
create table if not exists public.vi_quality_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.vi_personas(id) on delete cascade,
  subject_type text not null check (subject_type in ('identity_version', 'generation_job')),
  subject_id uuid not null,
  checks jsonb not null default '[]'::jsonb,
  overall text not null default 'pending' check (overall in ('pending', 'pass', 'fail')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);

create index if not exists vi_personas_owner_idx on public.vi_personas(owner_id);
create index if not exists vi_identity_versions_persona_idx on public.vi_identity_versions(persona_id, version desc);
create index if not exists vi_references_persona_idx on public.vi_references(persona_id, category);
create index if not exists vi_voice_profiles_persona_idx on public.vi_voice_profiles(persona_id);
create index if not exists vi_scenes_persona_idx on public.vi_scenes(persona_id);
create index if not exists vi_wardrobe_persona_idx on public.vi_wardrobe(persona_id);
create index if not exists vi_generation_jobs_persona_idx on public.vi_generation_jobs(persona_id, created_at desc);
create index if not exists vi_quality_reports_persona_idx on public.vi_quality_reports(persona_id);

-- Approved identity versions cannot be edited; only their status may move to superseded.
create or replace function public.vi_identity_versions_lock() returns trigger
language plpgsql set search_path = public as $$
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

drop trigger if exists vi_identity_versions_lock on public.vi_identity_versions;
create trigger vi_identity_versions_lock before update on public.vi_identity_versions
  for each row execute function public.vi_identity_versions_lock();

-- Foreign keys bypass RLS: make sure children only point at the same owner's persona, project and assets.
create or replace function public.vi_check_ownership() returns trigger
language plpgsql security definer set search_path = public as $$
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
  -- Nested IFs: NEW only has these columns on their own table and SQL does not guarantee short-circuiting.
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

revoke execute on function public.vi_check_ownership() from public, anon, authenticated;
revoke execute on function public.vi_identity_versions_lock() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['vi_personas', 'vi_identity_versions', 'vi_references', 'vi_voice_profiles', 'vi_scenes', 'vi_wardrobe', 'vi_generation_jobs', 'vi_quality_reports'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_ownership', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.vi_check_ownership()', t || '_ownership', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['vi_personas', 'vi_identity_versions', 'vi_references', 'vi_voice_profiles', 'vi_scenes', 'vi_wardrobe', 'vi_generation_jobs', 'vi_quality_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_owner_all') then
      execute format('create policy %I on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_owner_all', t);
    end if;
  end loop;
end $$;
