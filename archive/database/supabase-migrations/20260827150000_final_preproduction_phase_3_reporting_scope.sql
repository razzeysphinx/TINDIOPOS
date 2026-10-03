-- TINDIO final preproduction Phase 3: enforce store-scoped reporting for
-- operational reporting roles while retaining explicit organization-wide
-- access for store-management authority.
begin;

create or replace function private.get_scoped_reporting_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid,
  target_required_permission text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or target_required_permission not in ('dashboard.view', 'reports.view')
     or not (select private.has_permission(target_organization_id, target_required_permission)) then
    raise exception 'Reporting access is required.' using errcode = '42501';
  end if;

  -- `stores.manage` is the explicit organization-wide reporting authority.
  -- Any other reporting role must request one of its employee-store links.
  if not (select private.has_permission(target_organization_id, 'stores.manage')) then
    if target_store_id is null then
      raise exception 'Choose one of your assigned stores for reporting.' using errcode = '42501';
    end if;

    if not exists (
      select 1
      from public.employees employee
      join public.employee_stores assignment
        on assignment.employee_id = employee.id
       and assignment.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and assignment.store_id = target_store_id
    ) then
      raise exception 'Reporting is limited to your assigned stores.' using errcode = '42501';
    end if;
  end if;

  return private.get_reporting_snapshot(
    target_organization_id,
    target_start_date,
    target_end_date,
    target_store_id,
    target_required_permission
  );
end;
$$;

create or replace function public.get_dashboard_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_scoped_reporting_snapshot(
    target_organization_id,
    target_start_date,
    target_end_date,
    target_store_id,
    'dashboard.view'
  );
$$;

create or replace function public.get_reports_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_scoped_reporting_snapshot(
    target_organization_id,
    target_start_date,
    target_end_date,
    target_store_id,
    'reports.view'
  );
$$;

revoke execute on function private.get_reporting_snapshot(uuid,date,date,uuid,text) from authenticated;
revoke execute on function private.get_scoped_reporting_snapshot(uuid,date,date,uuid,text) from public, anon, service_role;
grant execute on function private.get_scoped_reporting_snapshot(uuid,date,date,uuid,text) to authenticated;

comment on function private.get_scoped_reporting_snapshot(uuid,date,date,uuid,text)
is 'Enforces report permission and employee-store scope before returning a security-definer reporting snapshot.';

commit;
