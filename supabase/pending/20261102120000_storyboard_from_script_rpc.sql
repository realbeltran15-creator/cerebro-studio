-- PROPUESTA PARA REVISION. NO aplicada en ningun Supabase. SIN PROBAR contra una base real (solo revisada).
-- Objetivo: crear/reanudar el storyboard de un guion de forma ATOMICA e idempotente (hoy la pantalla lo hace en dos pasos).
-- SECURITY INVOKER: se ejecuta con los permisos y la RLS del usuario que llama; no eleva privilegios.
create or replace function public.create_storyboard_from_script(p_script_id uuid, p_scenes jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_script public.scripts%rowtype;
  v_board uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_script from public.scripts where id = p_script_id and owner_id = auth.uid();
  if not found then raise exception 'script_not_found' using errcode = 'P0002'; end if;

  select id into v_board from public.storyboards where script_id = p_script_id and owner_id = auth.uid() order by created_at desc limit 1;
  if v_board is null then
    insert into public.storyboards (owner_id, project_id, script_id, title, aspect_ratio)
    values (auth.uid(), v_script.project_id, p_script_id, v_script.title || ' · guion v' || v_script.version, '16:9')
    returning id into v_board;
  end if;

  -- Solo inserta las escenas cuya clave (id de seccion o hook/CTA) aún no existe; posiciones libres; no toca las existentes.
  insert into public.scenes (owner_id, storyboard_id, position, duration_ms, narration, metadata)
  select auth.uid(), v_board,
         coalesce((select max(position) from public.scenes where storyboard_id = v_board), 0) + row_number() over (order by (e->>'position')::int),
         (e->>'duration_ms')::int, e->>'narration', coalesce(e->'metadata', '{}'::jsonb)
  from jsonb_array_elements(p_scenes) as e
  where not exists (
    select 1 from public.scenes s
    where s.storyboard_id = v_board
      and coalesce(s.metadata->>'script_section_id', 'h:' || (s.metadata->>'heading')) = coalesce(e->'metadata'->>'script_section_id', 'h:' || (e->'metadata'->>'heading'))
  );
  return v_board;
end;
$$;
revoke all on function public.create_storyboard_from_script(uuid, jsonb) from public, anon;
grant execute on function public.create_storyboard_from_script(uuid, jsonb) to authenticated;
