-- Cerebro Studio · Fábrica de Shorts de curiosidades (canal Umbral del Hito)
-- Aditiva y reversible. Un Short al día por propietario, aprobado por la persona antes de subirse.
-- Reversión: drop table public.shorts_factory_items; y volver a crear automations_kind_check sin 'shorts_factory'.

alter table public.automations drop constraint if exists automations_kind_check;
alter table public.automations add constraint automations_kind_check
  check (kind in ('trend_watch', 'opportunity_refresh', 'shorts_factory'));

create table if not exists public.shorts_factory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  render_job_id uuid references public.render_jobs(id) on delete set null,
  publication_job_id uuid references public.publication_jobs(id) on delete set null,
  status text not null default 'prepared' check (status in ('prepared', 'approved', 'published', 'discarded', 'failed')),
  topic text not null check (char_length(topic) between 1 and 200),
  -- palabras significativas del tema, ordenadas: evita repetir temas
  topic_key text not null,
  theme text not null,
  prepared_on date not null default ((now() at time zone 'utc')::date),
  -- evidencia: todo lo que la pantalla de aprobación muestra
  interest jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  spend jsonb not null default '{}'::jsonb,
  discarded_reason text,
  -- resultado: la retención media a 7 días se guarda como dato OBSERVADO de YouTube Analytics
  video_id text,
  published_at timestamptz,
  retention jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, topic_key)
);

-- Un solo Short preparado por día (los descartados y fallidos no cuentan).
create unique index if not exists shorts_factory_one_per_day
  on public.shorts_factory_items (owner_id, prepared_on) where status not in ('discarded', 'failed');
create index if not exists shorts_factory_owner_status_idx on public.shorts_factory_items (owner_id, status, created_at desc);

alter table public.shorts_factory_items enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shorts_factory_items' and policyname = 'shorts_factory_items_owner_all') then
    create policy shorts_factory_items_owner_all on public.shorts_factory_items for all
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;
