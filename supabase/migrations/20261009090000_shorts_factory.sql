-- Fábrica de Shorts de curiosidades (canal Umbral del Hito)
-- Aditivo. NO se aplica solo: revisar y aplicar con `supabase db push` / apply_migration.
-- Reutiliza: automations, automation_runs, approvals, publication_jobs, channel_connections, metric_snapshots.

-- 1) Permitir el tipo de automatización. (El constraint original no tiene nombre fijo en todos los entornos.)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.automations'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.automations drop constraint %I', c.conname);
  end loop;
  alter table public.automations
    add constraint automations_kind_check check (kind in ('trend_watch', 'opportunity_refresh', 'shorts_factory'));
end $$;

-- 2) Un registro por Short (también por los descartados: así se ve por qué no se creó).
create table if not exists public.shorts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_date date not null,
  status text not null default 'preparing' check (status in (
    'preparing', 'discarded', 'ready_for_approval', 'approved', 'rejected',
    'uploading', 'uploaded_private', 'upload_failed'
  )),
  discard_reason text,
  discard_detail jsonb not null default '{}'::jsonb,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  topic text,
  topic_key text,
  category text,
  -- Datos de interés y desglose de puntuación; cada valor etiquetado como observado o inferido.
  topic_selection jsonb not null default '{}'::jsonb,
  -- { claim, key_datum, sources: [{ url, domain, title, quote, verified_at }] }
  facts jsonb not null default '{}'::jsonb,
  script jsonb not null default '{}'::jsonb,
  -- Composición 9:16: escenas, subtítulos, tiempos, rutas de assets, música generada.
  manifest jsonb not null default '{}'::jsonb,
  -- Resultado de los controles previos a la aprobación (hook 2 s, fuentes, duración...).
  quality jsonb not null default '{}'::jsonb,
  title text,
  description text,
  tags text[] not null default '{}',
  synthetic_content boolean not null default true check (synthetic_content),
  project_id uuid references public.projects(id) on delete set null,
  publication_job_id uuid references public.publication_jobs(id) on delete set null,
  video_id text,
  privacy_status text,
  uploaded_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un Short vivo por día y por propietario; los descartados no bloquean un reintento manual.
create unique index if not exists shorts_one_live_per_day
  on public.shorts(owner_id, run_date) where status <> 'discarded';
-- Sin repetir temas.
create unique index if not exists shorts_topic_unique
  on public.shorts(owner_id, topic_key) where topic_key is not null and status <> 'discarded';
create index if not exists shorts_owner_created_idx on public.shorts(owner_id, created_at desc);
create index if not exists shorts_video_idx on public.shorts(owner_id, video_id) where video_id is not null;

alter table public.shorts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shorts' and policyname='shorts_owner_all') then
    create policy shorts_owner_all on public.shorts for all
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

-- 3) Bucket privado para imágenes y voz. Escribe solo el servidor (service role); el dueño lee.
insert into storage.buckets (id, name, public, file_size_limit)
values ('shorts-assets', 'shorts-assets', false, 52428800)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='shorts_assets_owner_read') then
    create policy shorts_assets_owner_read on storage.objects for select
      using (bucket_id = 'shorts-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;
