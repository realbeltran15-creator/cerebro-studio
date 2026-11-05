-- PROPUESTA (no aplicada a Production): una fila propia no puede apuntar al proyecto de otra persona.
-- Hallazgo (P5.11, E2E con dos usuarios reales): las políticas «owner_all» solo comprueban owner_id = auth.uid(), así que el usuario B
-- podía insertar activos o render_jobs con project_id = proyecto de A (no los veía A, pero B podía escribir en un proyecto ajeno y
-- averiguar si un id existe). Se añade una política RESTRICTIVA (se combina con AND con las existentes) en cada tabla pública con
-- columna project_id: en INSERT y UPDATE, project_id debe ser nulo o de un proyecto cuyo owner_id sea el usuario.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'project_id' and c.table_name <> 'projects'
  loop
    execute format('drop policy if exists %I on public.%I', r.table_name || '_project_must_be_own', r.table_name);
    execute format($f$create policy %I on public.%I as restrictive for all to authenticated
      using (true)
      with check (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))$f$,
      r.table_name || '_project_must_be_own', r.table_name);
  end loop;
end $$;
