-- Cerebro Studio · histórico del Radar
-- Aditivo: instantáneas de la lista de tendencias de YouTube por propietario, país y categoría.

create table if not exists public.trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'youtube' check (platform in ('youtube')),
  region text not null check (region ~ '^[A-Z]{2}$'),
  category_id text,
  source text not null default 'radar' check (source in ('radar', 'automation')),
  -- [{videoId, title, channelTitle, rank, views}] tal como los devolvió la API en ese momento.
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  fetched_at timestamptz not null default now()
);

alter table public.trend_snapshots enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trend_snapshots' and policyname = 'trend_snapshots_owner_all') then
    create policy trend_snapshots_owner_all on public.trend_snapshots for all
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

create index if not exists trend_snapshots_lookup_idx on public.trend_snapshots (owner_id, region, category_id, fetched_at desc);
