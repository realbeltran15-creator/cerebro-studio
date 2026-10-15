-- PREPARED, NOT APPLIED. Server-side copy of the campaigns designed in Campañas (today they live in the browser).
-- The database is shared by Preview and Production, so this file waits for the owner's explicit approval.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  status text not null default 'borrador' check (status in ('borrador', 'lista', 'archivada')),
  brief jsonb not null default '{}'::jsonb,
  notes text not null default '',
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_owner_updated_idx on public.campaigns (owner_id, updated_at desc);
alter table public.campaigns enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campaigns' and policyname = 'campaigns_owner_all') then
    create policy campaigns_owner_all on public.campaigns for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;
-- Future ad-account connections must store tokens ONLY encrypted and server-side (never in `brief`). They are intentionally not part of this migration.
