-- Store-scoped RLS must not bypass the organization lifecycle gate. A valid
-- assignment is not operational access when its tenant is suspended/archived.
begin;

create or replace function private.has_store_read_scope(
  target_organization_id uuid,
  target_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and target_store_id is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.status = 'active'
    )
    and (
      (select private.has_permission(target_organization_id, 'stores.manage'))
      or exists (
        select 1
        from public.employees employee
        join public.employee_stores assignment
          on assignment.organization_id = employee.organization_id
         and assignment.employee_id = employee.id
        where employee.organization_id = target_organization_id
          and employee.profile_id = (select auth.uid())
          and employee.status = 'active'
          and assignment.store_id = target_store_id
      )
    ),
    false
  );
$$;

comment on function private.has_store_read_scope(uuid, uuid)
is 'Requires an active authenticated employee, an active organization, and either stores.manage or an assigned store.';

commit;
