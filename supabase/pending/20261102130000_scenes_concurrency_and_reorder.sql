-- PROPUESTA PARA REVISION. NO aplicada en ningun Supabase. SIN PROBAR contra una base real.
-- 1) Control de concurrencia para escenas (hoy `scenes` no tiene updated_at).
alter table public.scenes add column if not exists updated_at timestamptz not null default now();
create or replace function public.touch_scene_updated_at() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists scenes_touch_updated_at on public.scenes;
create trigger scenes_touch_updated_at before update on public.scenes for each row execute function public.touch_scene_updated_at();

-- 2) Reordenar de forma ATOMICA: p_ids en el orden final deseado (debe ser exactamente el conjunto de escenas del storyboard).
-- SECURITY INVOKER: respeta la RLS del usuario.
create or replace function public.reorder_scenes(p_storyboard uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select count(*) into v_count from public.scenes where storyboard_id = p_storyboard and owner_id = auth.uid();
  if v_count <> coalesce(array_length(p_ids, 1), 0) or exists (
    select 1 from unnest(p_ids) as i(id) where not exists (select 1 from public.scenes s where s.id = i.id and s.storyboard_id = p_storyboard and s.owner_id = auth.uid())
  ) then raise exception 'scene_set_mismatch' using errcode = '22023'; end if;
  update public.scenes set position = position + 1000000 where storyboard_id = p_storyboard and owner_id = auth.uid();
  update public.scenes s set position = o.ord from unnest(p_ids) with ordinality as o(id, ord) where s.id = o.id;
end $$;
revoke all on function public.reorder_scenes(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_scenes(uuid, uuid[]) to authenticated;
