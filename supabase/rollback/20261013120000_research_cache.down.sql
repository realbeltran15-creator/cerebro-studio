-- Rollback of 20261013120000_research_cache.sql. Only removes data that the app can regenerate (a cache and a usage log).
drop function if exists public.research_reserve(text, integer, integer, integer);
drop function if exists public.research_lock(text, integer);
drop function if exists public.research_quota_day_start();
drop table if exists public.research_cache;
