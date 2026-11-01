-- Rollback de 20261101120000_job_queue.sql. Solo elimina objetos creados por esa migracion.
-- ADVERTENCIA: borra el historial de la cola y del presupuesto. Exportar antes si importa:
--   select * from public.job_queue; select * from public.budget_entries;
-- (Requiere autorizacion expresa de Jesus: es una eliminacion de datos de las tablas NUEVAS.)
drop function if exists public.reserve_budget(uuid, uuid, text, text, uuid, text, numeric, text);
drop function if exists public.claim_next_job(text, int);
drop table if exists public.budget_entries;
drop table if exists public.budget_limits;
drop table if exists public.job_approvals;
drop table if exists public.job_queue;
