-- Rollback de 20261101120000_job_queue.sql. Solo elimina objetos creados por esa migracion.
-- ADVERTENCIA: borra el historial de la cola y del presupuesto. Exportar antes si importa:
--   select * from public.job_queue; select * from public.budget_entries;
-- (Requiere autorizacion expresa de Jesus: es una eliminacion de datos de las tablas NUEVAS.)
drop function if exists public.resolve_uncertain_budget(uuid, text, boolean, numeric);
drop function if exists public.mark_budget_uncertain(uuid, text);
drop function if exists public.release_budget(uuid, text);
drop function if exists public.settle_budget(uuid, text, text, numeric);
drop function if exists public.check_approval(uuid, text, text);
drop function if exists public.finish_job(uuid, uuid, text, jsonb, jsonb, text, timestamptz);
drop function if exists public.save_job_steps(uuid, uuid, jsonb, text);
drop function if exists public.heartbeat_job(uuid, uuid, int);
drop function if exists public.reserve_budget(uuid, uuid, text, text, uuid, text, numeric, text);
drop function if exists public.claim_next_job(text, int);
drop table if exists public.budget_entries;
drop table if exists public.budget_limits;
drop table if exists public.job_approvals;
drop table if exists public.job_queue;
drop function if exists public.job_queue_terminal_guard();
