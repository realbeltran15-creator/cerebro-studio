-- Cerebro Studio · Fase 4B · cola de trabajos + presupuestos agregados
-- ESTADO: PENDIENTE DE APROBACION. NO esta en supabase/migrations a proposito:
-- ninguna herramienta de despliegue la aplica. Solo aditiva (tablas/funciones nuevas);
-- no toca ninguna tabla existente. Reversible con 20261101120000_job_queue.rollback.sql.

-- ───────────────────────── job_queue ─────────────────────────
create table if not exists public.job_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  kind text not null check (char_length(kind) between 1 and 64),
  status text not null default 'pending'
    check (status in ('pending','running','awaiting_approval','completed','failed','cancelled')),
  -- Ambito de idempotencia: (propietario, tipo, clave). Misma clave = mismo trabajo.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null,                 -- las aprobaciones se sellan contra este hash
  priority int not null default 100 check (priority between 0 and 1000),   -- menor = antes
  available_at timestamptz not null default now(),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  -- Lease: solo el ejecutor con claim_token vigente puede escribir.
  executor_id text,
  claim_token uuid,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  cancel_requested boolean not null default false,
  current_step text,
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  result jsonb,
  error jsonb,                                -- {code, message, httpStatus?, retryable}
  awaiting_reason text,                       -- por que espera a una persona
  -- Presupuesto: estimacion declarada al encolar (por unidad) y modo.
  budget_estimate jsonb not null default '{}'::jsonb check (jsonb_typeof(budget_estimate) = 'object'),
  dry_run boolean not null default true,      -- simulacion por defecto
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint job_queue_idem_unique unique (owner_id, kind, idempotency_key),
  constraint job_queue_running_has_lease check (
    status <> 'running' or (executor_id is not null and claim_token is not null and lease_expires_at is not null)
  )
);

create index if not exists job_queue_claim_idx on public.job_queue (priority, available_at)
  where status = 'pending';
create index if not exists job_queue_lease_idx on public.job_queue (lease_expires_at)
  where status = 'running';
create index if not exists job_queue_owner_idx on public.job_queue (owner_id, created_at desc);
create index if not exists job_queue_project_idx on public.job_queue (project_id) where project_id is not null;

-- ───────────────────────── aprobaciones selladas ─────────────────────────
create table if not exists public.job_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.job_queue(id) on delete cascade,
  step text not null,
  action text not null check (action in ('spend','render_batch','publish','retry_uncertain')),
  payload_hash text not null,                  -- se invalida si el payload del trabajo cambia
  max_amount jsonb not null default '{}'::jsonb,  -- tope por unidad, p. ej. {"eur":0}
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint job_approvals_unique unique (job_id, step, action)
);
create index if not exists job_approvals_job_idx on public.job_approvals (job_id);

-- ───────────────────────── presupuestos ─────────────────────────
create table if not exists public.budget_limits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 64),
  project_id uuid references public.projects(id) on delete cascade,  -- null = todos los proyectos
  unit text not null check (unit in ('eur','usd','credits','quota')),
  daily_limit numeric(14,4) not null default 0 check (daily_limit >= 0),  -- 0 = nada autorizado
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists budget_limits_scope_idx on public.budget_limits
  (owner_id, provider, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), unit);

create table if not exists public.budget_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.job_queue(id) on delete set null,
  step text,
  provider text not null,
  project_id uuid references public.projects(id) on delete set null,
  unit text not null check (unit in ('eur','usd','credits','quota')),
  day date not null,
  reserved numeric(14,4) not null check (reserved >= 0),
  actual numeric(14,4) check (actual >= 0),
  state text not null default 'reserved' check (state in ('reserved','uncertain','settled','released')),
  idempotency_key text not null,               -- una reserva por (trabajo, paso, unidad)
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint budget_entries_idem unique (owner_id, idempotency_key)
);
create index if not exists budget_entries_day_idx on public.budget_entries (owner_id, provider, unit, day);

-- ───────────────────────── RLS ─────────────────────────
alter table public.job_queue enable row level security;
alter table public.job_approvals enable row level security;
alter table public.budget_limits enable row level security;
alter table public.budget_entries enable row level security;

-- El usuario ve y cancela lo suyo. NO puede marcar completado, cambiar estado, lease ni presupuesto:
-- esas escrituras solo las hace el ejecutor con service_role (que salta RLS).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_queue' and policyname='job_queue_owner_select') then
    create policy job_queue_owner_select on public.job_queue for select using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_approvals' and policyname='job_approvals_owner_select') then
    create policy job_approvals_owner_select on public.job_approvals for select using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='budget_limits' and policyname='budget_limits_owner_select') then
    create policy budget_limits_owner_select on public.budget_limits for select using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='budget_entries' and policyname='budget_entries_owner_select') then
    create policy budget_entries_owner_select on public.budget_entries for select using (owner_id = (select auth.uid()));
  end if;
end $$;
-- Sin politicas de insert/update/delete para usuarios: crear, cancelar y aprobar pasan por
-- rutas de servidor que validan sesion y propiedad y escriben con service_role.

revoke all on public.job_queue, public.job_approvals, public.budget_limits, public.budget_entries from anon, authenticated;
grant select on public.job_queue, public.job_approvals, public.budget_limits, public.budget_entries to authenticated;

-- ───────────────────────── funciones atomicas ─────────────────────────
-- Reclamar: un solo ejecutor gana (FOR UPDATE SKIP LOCKED). Recupera tambien leases caducados.
create or replace function public.claim_next_job(p_executor text, p_lease_seconds int default 60)
returns public.job_queue
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job_queue;
begin
  select * into j from public.job_queue
   where ((status = 'pending' and available_at <= now())
       or (status = 'running' and lease_expires_at < now()))
   order by priority, available_at
   for update skip locked
   limit 1;
  if not found then return null; end if;
  update public.job_queue set
      status = 'running', executor_id = p_executor, claim_token = gen_random_uuid(),
      locked_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
    where id = j.id
    returning * into j;
  return j;
end $$;

-- Reserva atomica: serializa por (propietario, proveedor, unidad, dia) con advisory lock.
-- Devuelve true solo si cabe en el limite. Sin limite configurado = limite 0.
create or replace function public.reserve_budget(
  p_owner uuid, p_job uuid, p_step text, p_provider text, p_project uuid,
  p_unit text, p_amount numeric, p_key text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare lim numeric; used numeric; today date := (now() at time zone 'utc')::date; k text := p_key || ':' || p_unit;   -- misma convencion que settle/release
begin
  if p_amount is null or p_amount < 0 then return false; end if;   -- precio desconocido = bloqueo
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || p_provider || p_unit || today::text, 0));
  if exists (select 1 from public.budget_entries where owner_id = p_owner and idempotency_key = k) then
    return true;                                                    -- reintento: no duplica
  end if;
  select coalesce(min(daily_limit), 0) into lim from public.budget_limits
   where owner_id = p_owner and provider = p_provider and unit = p_unit
     and (project_id is null or project_id = p_project);
  select coalesce(sum(case when state = 'settled' then actual when state in ('reserved','uncertain') then reserved else 0 end), 0)
    into used from public.budget_entries
   where owner_id = p_owner and provider = p_provider and unit = p_unit and day = today and state <> 'released';
  if used + p_amount > lim then return false; end if;
  insert into public.budget_entries (owner_id, job_id, step, provider, project_id, unit, day, reserved, idempotency_key)
    values (p_owner, p_job, p_step, p_provider, p_project, p_unit, today, p_amount, k);
  return true;
end $$;


-- Escrituras del ejecutor con fencing: solo el dueno del lease vigente (claim_token) puede escribir.
create or replace function public.heartbeat_job(p_id uuid, p_token uuid, p_lease_seconds int default 60)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.job_queue set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = p_id and claim_token = p_token and status = 'running' and lease_expires_at >= now();
  return found;
end $$;

create or replace function public.save_job_steps(p_id uuid, p_token uuid, p_steps jsonb, p_current text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.job_queue set steps = p_steps, current_step = p_current, updated_at = now()
   where id = p_id and claim_token = p_token and status = 'running' and lease_expires_at >= now();
  return found;
end $$;

-- Termina, espera aprobacion o devuelve a la cola (p_status = 'pending' + p_available_at). Libera el lease.
create or replace function public.finish_job(p_id uuid, p_token uuid, p_status text, p_result jsonb default null,
  p_error jsonb default null, p_awaiting text default null, p_available_at timestamptz default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('pending','awaiting_approval','completed','failed','cancelled') then return false; end if;
  update public.job_queue set status = p_status, result = coalesce(p_result, result), error = p_error,
      awaiting_reason = p_awaiting, available_at = coalesce(p_available_at, available_at),
      executor_id = null, claim_token = null, lease_expires_at = null, locked_at = null,
      finished_at = case when p_status in ('completed','failed','cancelled') then now() else finished_at end,
      updated_at = now()
   where id = p_id and claim_token = p_token and status = 'running' and lease_expires_at >= now();
  return found;
end $$;

-- Los estados terminales son inmutables: nada puede «resucitar» un trabajo completado, fallido o cancelado.
create or replace function public.job_queue_terminal_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('completed','failed','cancelled') and new.status is distinct from old.status then
    raise exception 'job % ya esta en estado terminal %', old.id, old.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists job_queue_terminal_guard on public.job_queue;
create trigger job_queue_terminal_guard before update on public.job_queue for each row execute function public.job_queue_terminal_guard();

-- Fuente unica de verdad de las aprobaciones: devuelve el problema (o null si es valida).
create or replace function public.check_approval(p_job uuid, p_step text, p_action text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.job_approvals; j public.job_queue;
begin
  select * into j from public.job_queue where id = p_job;
  if not found then return 'job_not_found'; end if;
  select * into a from public.job_approvals where job_id = p_job and step = p_step and action = p_action;
  if not found then return 'approval_missing'; end if;
  if a.owner_id <> j.owner_id then return 'approval_invalidated'; end if;
  if a.revoked_at is not null then return 'approval_revoked'; end if;
  if a.expires_at <= now() then return 'approval_expired'; end if;
  if a.payload_hash <> j.payload_hash then return 'approval_invalidated'; end if;
  return null;
end $$;

-- Presupuesto: conciliar, liberar (solo lo NO incierto) y resolver lo incierto a mano.
-- Las claves de reserva son «<base>:<unidad>»; starts_with evita comodines LIKE.
create or replace function public.settle_budget(p_owner uuid, p_keybase text, p_unit text, p_actual numeric)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.budget_entries set state = 'settled', actual = coalesce(p_actual, reserved), settled_at = now()
   where owner_id = p_owner and idempotency_key = p_keybase || ':' || p_unit and state in ('reserved','uncertain');
  return found;
end $$;

create or replace function public.release_budget(p_owner uuid, p_keybase text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.budget_entries set state = 'released', settled_at = now()
   where owner_id = p_owner and starts_with(idempotency_key, p_keybase || ':') and state = 'reserved';   -- 'uncertain' NO se libera
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mark_budget_uncertain(p_owner uuid, p_keybase text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.budget_entries set state = 'uncertain'
   where owner_id = p_owner and starts_with(idempotency_key, p_keybase || ':') and state = 'reserved';
  get diagnostics n = row_count;
  return n;
end $$;

-- Solo una persona (via ruta de servidor) decide el destino de lo incierto: cobrado (actual) o no cobrado.
create or replace function public.resolve_uncertain_budget(p_owner uuid, p_keybase text, p_charged boolean, p_actual numeric default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.budget_entries set
      state = case when p_charged then 'settled' else 'released' end,
      actual = case when p_charged then coalesce(p_actual, reserved) else actual end, settled_at = now()
   where owner_id = p_owner and starts_with(idempotency_key, p_keybase || ':') and state = 'uncertain';
  get diagnostics n = row_count;
  return n;
end $$;

-- Solo service_role ejecuta las funciones privilegiadas. Ningun otro rol (ni public) puede.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('claim_next_job','reserve_budget','heartbeat_job','save_job_steps','finish_job',
              'check_approval','settle_budget','release_budget','mark_budget_uncertain','resolve_uncertain_budget') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
