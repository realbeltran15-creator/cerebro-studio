do $$
declare r record;
begin
  for r in select c.table_name from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'project_id' and c.table_name <> 'projects'
  loop execute format('drop policy if exists %I on public.%I', r.table_name || '_project_must_be_own', r.table_name); end loop;
end $$;
