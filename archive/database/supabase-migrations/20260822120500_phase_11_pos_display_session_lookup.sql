-- TINDIO Phase 11 follow-up: expose the opaque session id only to the paired POS.
-- The customer-facing bootstrap continues to return only a sanitized state and topic.

begin;

create or replace function private.get_pos_customer_display_sessions_with_ids(
  target_organization_id uuid
)
returns table (
  session_id uuid,
  register_id uuid,
  realtime_topic text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  return query
  select display.id, display.register_id, display.realtime_topic
  from public.customer_display_sessions display
  where display.organization_id = target_organization_id
    and display.is_active
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and employee_store.store_id = display.store_id
    );
end;
$$;

create or replace function public.get_pos_customer_display_sessions_with_ids(
  target_organization_id uuid
)
returns table (
  session_id uuid,
  register_id uuid,
  realtime_topic text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_pos_customer_display_sessions_with_ids($1);
$$;

revoke execute on function
  private.get_pos_customer_display_sessions_with_ids(uuid),
  public.get_pos_customer_display_sessions_with_ids(uuid)
from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.get_pos_customer_display_sessions_with_ids(uuid)
to authenticated;
grant execute on function public.get_pos_customer_display_sessions_with_ids(uuid)
to authenticated;

comment on function public.get_pos_customer_display_sessions_with_ids(uuid)
is 'Returns active customer-display session IDs and scoped Realtime topics only to authorized POS users assigned to each store.';

commit;
