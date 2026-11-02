create schema if not exists ai_memory;

create table ai_memory.projects (
  id uuid primary key default gen_random_uuid(),
  project_key text not null unique,
  project_name text not null,
  objective text,
  current_status text,
  next_action text,
  original_pillars jsonb not null default '[]'::jsonb,
  key_decisions jsonb not null default '[]'::jsonb,
  direction_changes jsonb not null default '[]'::jsonb,
  pending_items jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  ai_recommendations jsonb not null default '[]'::jsonb,
  last_updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ai_memory.activity_log (
  id bigint generated always as identity primary key,
  project_id uuid not null references ai_memory.projects(id) on delete cascade,
  actor text not null,
  event_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_project_created_idx on ai_memory.activity_log(project_id, created_at desc);

revoke all on schema ai_memory from public, anon, authenticated;
revoke all on all tables in schema ai_memory from public, anon, authenticated;

grant usage on schema ai_memory to service_role;
grant select, insert, update, delete on all tables in schema ai_memory to service_role;
grant usage, select on all sequences in schema ai_memory to service_role;
