-- PROPUESTA (NO APLICADA, SIN PROBAR). Reserva ATÓMICA de gasto: comprueba el tope y registra en la misma transacción,
-- con un bloqueo por usuario, para que N peticiones simultáneas no superen el tope (hoy la comprobación y el registro son pasos separados;
-- la reserva en memoria de la ruta solo cubre una instancia).
-- Requiere que generation_spend exista (migración 20261018120000). Idempotente por (owner_id, request_id).
create or replace function public.reserve_generation_spend(
  p_owner uuid, p_request text, p_provider text, p_model text, p_tier text,
  p_estimate numeric, p_daily_cap numeric, p_monthly_cap numeric
) returns text language plpgsql security definer set search_path = public as $$
declare v_day numeric; v_month numeric; v_existing int;
begin
  perform pg_advisory_xact_lock(hashtextextended('generation_spend:' || p_owner::text, 0));
  select count(*) into v_existing from public.generation_spend where owner_id = p_owner and request_id = p_request;
  if v_existing > 0 then return 'duplicate'; end if;
  select coalesce(sum(estimate_usd), 0) into v_day from public.generation_spend
    where owner_id = p_owner and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select coalesce(sum(estimate_usd), 0) into v_month from public.generation_spend
    where owner_id = p_owner and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  if p_daily_cap = 0 or p_monthly_cap = 0 or v_day + p_estimate > p_daily_cap + 1e-9 then return 'daily_cap'; end if;
  if v_month + p_estimate > p_monthly_cap + 1e-9 then return 'monthly_cap'; end if;
  insert into public.generation_spend(owner_id, request_id, provider, model, tier, estimate_usd) values (p_owner, p_request, p_provider, p_model, p_tier, p_estimate);
  return 'reserved';
end $$;
revoke all on function public.reserve_generation_spend(uuid, text, text, text, text, numeric, numeric, numeric) from public, anon, authenticated;
