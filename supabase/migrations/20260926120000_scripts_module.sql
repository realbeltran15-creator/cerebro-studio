-- Cerebro Studio · módulo de guiones
-- Aditivo: crea public.scripts y enlaza storyboards con el guion del que provienen.
-- No modifica ni borra datos existentes.

create table if not exists public.scripts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_opportunity_id uuid references public.opportunities(id) on delete set null,
  parent_id uuid references public.scripts(id) on delete set null,
  version integer not null default 1 check (version > 0),
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'archived')),
  idea text,
  brief text,
  hook text,
  cta text,
  -- Array de secciones: {id, heading, basis, text, sources[], speaker}
  -- basis ∈ verified_fact | testimony | reconstruction | interpretation
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version)
);

alter table public.scripts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scripts' and policyname = 'scripts_owner_all') then
    create policy scripts_owner_all on public.scripts for all
      using (owner_id = (select auth.uid()))
      with check (owner_id = (select auth.uid()));
  end if;
end $$;

create index if not exists scripts_owner_project_idx on public.scripts (owner_id, project_id);
create index if not exists scripts_parent_idx on public.scripts (parent_id);
create index if not exists scripts_source_opportunity_idx on public.scripts (source_opportunity_id);

alter table public.storyboards
  add column if not exists script_id uuid references public.scripts(id) on delete set null;

create index if not exists storyboards_script_idx on public.storyboards (script_id);
