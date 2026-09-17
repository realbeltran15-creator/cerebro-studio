-- Append-only audit trail for opportunity lifecycle transitions.
-- The client cannot write audit_log directly; this trigger records status changes
-- inside the database while preserving the existing owner-scoped RLS model.

create or replace function public.audit_opportunity_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status then
    insert into public.audit_log (owner_id, action, entity_type, entity_id, details)
    values (
      new.owner_id,
      'status_changed',
      'opportunity',
      new.id::text,
      jsonb_build_object('from_status', old.status, 'to_status', new.status)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_opportunity_status_transition() from public;
revoke all on function public.audit_opportunity_status_transition() from anon;
revoke all on function public.audit_opportunity_status_transition() from authenticated;

drop trigger if exists opportunities_audit_status_transition on public.opportunities;
create trigger opportunities_audit_status_transition
after update of status on public.opportunities
for each row
when (old.status is distinct from new.status)
execute function public.audit_opportunity_status_transition();
