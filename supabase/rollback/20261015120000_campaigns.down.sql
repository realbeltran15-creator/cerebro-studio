-- Rollback of 20261015120000_campaigns.sql. DESTRUCTIVE for any campaign saved on the server: export them first
-- (select id, name, status, brief, notes from public.campaigns) if the table has been used.
drop table if exists public.campaigns;
