-- Align application and database store-scope semantics around the existing
-- `stores.manage` capability. This is intentionally capability-based: an
-- organization may grant it to a customer-created role without code changes.
begin;

create or replace function private.has_organization_store_scope(
  target_organization_id uuid
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
    and (select private.has_permission(target_organization_id, 'stores.manage')),
    false
  );
$$;

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

-- Recovery-drill recording is intentionally Owner-only by default. Earlier
-- provisioning created Admin bundles before that exception existed, leaving
-- stale rows in already-created organizations. Remove only that documented
-- default; custom roles keep whatever capability their organization assigns.
delete from public.role_permissions role_permission
using public.roles role
where role_permission.organization_id = role.organization_id
  and role_permission.role_id = role.id
  and role.is_system
  and role.code = 'admin'
  and role_permission.permission_code = 'recovery.manage';

revoke all on function private.has_organization_store_scope(uuid)
from public, anon, authenticated, service_role;

comment on function private.has_organization_store_scope(uuid)
is 'Capability-defined organization-wide store scope. Requires an active employee, active organization, and stores.manage.';

comment on function private.has_store_read_scope(uuid, uuid)
is 'Requires an active authenticated employee and either capability-defined organization-wide stores.manage scope or an assigned store.';

commit;
