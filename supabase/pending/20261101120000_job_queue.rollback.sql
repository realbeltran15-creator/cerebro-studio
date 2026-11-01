-- Rollback de 20261101120000_job_queue.sql. Solo elimina objetos creados por esa migracion.
-- ADVERTENCIA: borra el historial de la cola y del presupuesto. Exportar antes si importa:
--   select * from public.job_queue; select * from public.budget_entries;
-- (Requiere autorizacion expresa de Jesus: es una eliminacion de datos de las tablas NUEVAS.)
drop function if exists public.reserve_budget_multi(uuid, uuid, text, text, uuid, jsonb, text);
drop function if exists public.budget_used(uuid, text, text);
drop function if exists public.set_budget_limit(uuid, text, uuid, text, numeric);
drop function if exists public.get_approval(uuid, text, text);
drop function if exists public.revoke_approval(uuid, uuid, text, text);
drop function if exists public.grant_approval(uuid, uuid, text, text, text, jsonb, timestamptz);
drop function if exists public.resume_job(uuid, uuid);
drop function if exists public.request_cancel_job(uuid, uuid);
drop function if exists public.get_job(uuid);
drop function if exists public.enqueue_job(uuid, uuid, text, text, jsonb, text, int, int, boolean);
drop function if exists public.resolve_uncertain_budget(uuid, text, boolean, numeric);
drop function if exists public.mark_budget_uncertain(uuid, text);
drop function if exists public.release_budget(uuid, text);
drop function if exists public.settle_budget(uuid, text, text, numeric);
drop function if exists public.check_approval(uuid, text, text);
drop function if exists public.finish_job(uuid, uuid, text, jsonb, jsonb, text, timestamptz);
drop function if exists public.save_job_steps(uuid, uuid, jsonb, text);
drop function if exists public.heartbeat_job(uuid, uuid, int);
drop function if exists public.reserve_budget(uuid, uuid, text, text, uuid, text, numeric, text);
drop function if exists public.claim_next_job(text, int, text[]);
drop table if exists public.budget_entries;
drop table if exists public.budget_limits;
drop table if exists public.job_approvals;
drop table if exists public.job_queue;
drop function if exists public.job_queue_terminal_guard();
