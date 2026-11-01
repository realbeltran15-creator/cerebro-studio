select c.relname||': '||string_agg(a.attname||' '||replace(format_type(a.atttypid,a.atttypmod),'timestamp with time zone','timestamptz')||case when a.attnotnull then ' NN' else '' end, ', ' order by a.attnum)
from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
where n.nspname='public' and c.relkind='r' group by c.relname order by c.relname;
