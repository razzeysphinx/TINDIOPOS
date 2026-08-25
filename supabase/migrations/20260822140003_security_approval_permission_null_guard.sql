-- TINDIO Improvement 1: a missing transaction-local approval context must be
-- false, never SQL NULL. NULL would make `if not has_permission(...)` guards
-- skip their denial branch in callers that use a PL/pgSQL IF condition.

begin;

create or replace function private.has_permission(
  target_organization_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      (select auth.uid()) is not null
      and exists (
        select 1
        from public.employees employee
        join public.employee_roles employee_role
          on employee_role.employee_id = employee.id
         and employee_role.organization_id = employee.organization_id
        join public.role_permissions role_permission
          on role_permission.role_id = employee_role.role_id
         and role_permission.organization_id = employee_role.organization_id
        where employee.organization_id = target_organization_id
          and employee.profile_id = (select auth.uid())
          and employee.status = 'active'
          and role_permission.permission_code = requested_permission
      )
    )
    or (
      (select auth.uid()) is not null
      and coalesce(current_setting('tindio.approval_profile_id', true), '') = (select auth.uid())::text
      and coalesce(current_setting('tindio.approval_organization_id', true), '') = target_organization_id::text
      and coalesce(current_setting('tindio.approval_permission', true), '') = requested_permission
    );
$$;

revoke execute on function private.has_permission(uuid, text)
from public, anon, service_role;
grant execute on function private.has_permission(uuid, text) to authenticated;

commit;
