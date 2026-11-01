select 'tables '||count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r'
union all select 'constraints '||count(*) from pg_constraint where connamespace='public'::regnamespace and contype in ('p','u','f','c')
union all select 'indexes_total '||count(*) from pg_indexes where schemaname='public'
union all select 'policies_public '||count(*) from pg_policies where schemaname='public'
union all select 'policies_storage '||count(*) from pg_policies where schemaname='storage'
union all select 'functions '||count(*) from pg_proc where pronamespace='public'::regnamespace
union all select 'triggers '||count(*) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace);
