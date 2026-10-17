-- Cerebro Studio · automatizaciones
-- Aditivo: crea public.automations y public.automation_runs con RLS por propietario.
-- Las automatizaciones solo leen fuentes y escriben en el workspace; nunca publican.

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('trend_watch', 'opportunity_refresh')),
  name text not null check (char_length(name) between 1 and 120),
  enabled boolean not null default true,
  schedule text not null default 'daily' check (schedule in ('manual', 'daily')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'schedule')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'automations' and policyname = 'automations_owner_all') then
    create policy automations_owner_all on public.automations for all
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'automation_runs' and policyname = 'automation_runs_owner_all') then
    create policy automation_runs_owner_all on public.automation_runs for all
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

create index if not exists automations_owner_idx on public.automations (owner_id);
create index if not exists automations_due_idx on public.automations (schedule, enabled, last_run_at);
create index if not exists automation_runs_automation_idx on public.automation_runs (automation_id, started_at desc);
create index if not exists automation_runs_owner_idx on public.automation_runs (owner_id);
