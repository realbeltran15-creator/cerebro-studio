-- PREPARED, NOT APPLIED. Server-side copy of the campaigns designed in Campañas (today they live in the browser).
-- The database is shared by Preview and Production, so this file waits for the owner's explicit approval.
-- Verified against a throw-away local PostgreSQL with Supabase-style stubs: see scripts/test-migrations.sh and docs/informe-migraciones.md.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 200),
  status text not null default 'borrador' check (status in ('borrador', 'lista', 'archivada')),
  brief jsonb not null default '{}'::jsonb check (pg_column_size(brief) < 200000),
  notes text not null default '' check (char_length(notes) <= 4000),
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_owner_updated_idx on public.campaigns (owner_id, updated_at desc);
create index if not exists campaigns_project_idx on public.campaigns (project_id) where project_id is not null;
alter table public.campaigns enable row level security;
-- Supabase grants table privileges to anon by default; RLS already hides every row from them, and the grant is removed as defence in depth.
revoke all on public.campaigns from anon;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'campaigns' and policyname = 'campaigns_owner_all') then
    -- The linked project must belong to the same user: a foreign key alone would accept any project id.
    create policy campaigns_owner_all on public.campaigns for all to authenticated
      using (owner_id = (select auth.uid()))
      with check (owner_id = (select auth.uid()) and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))));
  end if;
end $$;
-- Future ad-account connections must store tokens ONLY encrypted and server-side (never in `brief`). They are intentionally not part of this migration.
