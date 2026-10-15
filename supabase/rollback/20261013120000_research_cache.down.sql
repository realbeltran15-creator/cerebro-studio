-- Rollback of 20261013120000_research_cache.sql. Only removes data that the app can regenerate (a cache and a usage log).
drop table if exists public.research_cache;
