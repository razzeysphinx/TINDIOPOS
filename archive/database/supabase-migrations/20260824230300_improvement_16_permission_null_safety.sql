-- Missing approval context is NULL in PostgreSQL. Coalesce the final
-- predicate so a caller without a matching permission is always denied,
-- never allowed by a PL/pgSQL `if not permission` NULL branch.

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
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.status = 'active'
    )
    and (
      exists (
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
      or (
        current_setting('tindio.approval_profile_id', true) = (select auth.uid())::text
        and current_setting('tindio.approval_organization_id', true) = target_organization_id::text
        and current_setting('tindio.approval_permission', true) = requested_permission
      )
    ),
    false
  );
$$;

notify pgrst, 'reload schema';

commit;
