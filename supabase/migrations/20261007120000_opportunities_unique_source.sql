-- Prevents the same video/URL being saved twice as an opportunity by the same owner (two tabs, an automation and a manual save, etc.).
-- Additive and reversible (drop index). Safe to apply only if this returns no rows:
--   select owner_id, source_platform, source_id, count(*) from public.opportunities
--   where source_id is not null group by 1,2,3 having count(*) > 1;
-- Manual opportunities (source_id is null) are not affected.
create unique index if not exists opportunities_owner_source_unique
  on public.opportunities (owner_id, source_platform, source_id)
  where source_id is not null;
