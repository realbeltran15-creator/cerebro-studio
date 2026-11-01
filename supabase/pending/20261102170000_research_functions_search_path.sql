-- PROPUESTA (NO APLICADA). Resuelve el aviso del asesor de seguridad de Supabase "function_search_path_mutable" (nivel WARN, lectura 2026-11-01)
-- en las tres funciones de la caché de investigación. No cambia su lógica ni sus permisos: solo fija search_path.
alter function public.research_quota_day_start() set search_path = public, pg_temp;
alter function public.research_reserve(text, integer, integer, integer, integer, integer) set search_path = public, pg_temp;
alter function public.research_lock(text, integer) set search_path = public, pg_temp;
