-- Preserve the lifecycle gate for both organization-wide and assigned-store
-- access. The organization-wide helper already checks activity, but the
-- assignment branch must not bypass it.
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
      (select private.has_organization_store_scope(target_organization_id))
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
is 'Requires an active authenticated employee and active organization, then either capability-defined organization-wide stores.manage scope or an assigned store.';

commit;
