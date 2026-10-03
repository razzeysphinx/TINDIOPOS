-- TINDIO Planning Cycle Phase 1: atomic role and employee management edits.
-- These routines preserve tenant scope, prevent privilege escalation, and write
-- immutable audit entries for security-sensitive changes.

begin;

create or replace function public.update_custom_role(
  target_organization_id uuid,
  target_role_id uuid,
  role_name text,
  role_description text,
  permission_codes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(role_name);
  normalized_description text := nullif(btrim(role_description), '');
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'roles.manage')) then
    raise exception 'Role management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 2 and 80 then
    raise exception 'Role name must contain between 2 and 80 characters.' using errcode = '22023';
  end if;

  if coalesce(cardinality(permission_codes), 0) = 0 then
    raise exception 'Select at least one permission.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.roles role
    where role.id = target_role_id
      and role.organization_id = target_organization_id
      and role.is_system
  ) then
    raise exception 'System roles cannot be edited.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.roles role
    where role.id = target_role_id
      and role.organization_id = target_organization_id
      and not role.is_system
  ) then
    raise exception 'Select a custom role in this organization.' using errcode = '23503';
  end if;

  if exists (
    select 1
    from (
      select distinct unnest(permission_codes) as permission_code
    ) requested_permission
    left join public.permissions permission
      on permission.code = requested_permission.permission_code
    where permission.code is null
  ) then
    raise exception 'One or more requested permissions do not exist.' using errcode = '23503';
  end if;

  if exists (
    select 1
    from (
      select distinct unnest(permission_codes) as permission_code
    ) requested_permission
    where not (select private.has_permission(target_organization_id, requested_permission.permission_code))
  ) then
    raise exception 'You cannot grant a permission you do not hold.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  update public.roles
  set
    name = normalized_name,
    description = normalized_description
  where id = target_role_id
    and organization_id = target_organization_id
    and not is_system;

  delete from public.role_permissions
  where organization_id = target_organization_id
    and role_id = target_role_id;

  insert into public.role_permissions (
    organization_id,
    role_id,
    permission_code
  )
  select
    target_organization_id,
    target_role_id,
    requested_permission.permission_code
  from (
    select distinct unnest(permission_codes) as permission_code
  ) requested_permission;

  perform private.write_audit_log(
    target_organization_id,
    'CUSTOM_ROLE_UPDATED',
    'roles.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('role_id', target_role_id, 'permission_count', cardinality(permission_codes))
  );

  return target_role_id;
end;
$$;

create or replace function public.update_employee_assignments(
  target_organization_id uuid,
  target_employee_id uuid,
  target_job_title text,
  target_status text,
  target_role_ids uuid[],
  target_store_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_job_title text := nullif(btrim(target_job_title), '');
  normalized_status text := lower(btrim(target_status));
  actor_employee_id uuid;
  target_profile_id uuid;
  valid_role_count integer;
  valid_store_count integer;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'employees.manage')) then
    raise exception 'Employee management permission is required.' using errcode = '42501';
  end if;

  if normalized_status not in ('active', 'inactive', 'suspended') then
    raise exception 'Choose an active, inactive, or suspended employee status.' using errcode = '22023';
  end if;

  if normalized_job_title is not null and char_length(normalized_job_title) > 120 then
    raise exception 'Job title must contain at most 120 characters.' using errcode = '22023';
  end if;

  if coalesce(cardinality(target_role_ids), 0) = 0
    or coalesce(cardinality(target_store_ids), 0) = 0 then
    raise exception 'Assign at least one role and one active store.' using errcode = '22023';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  select employee.profile_id
  into target_profile_id
  from public.employees employee
  where employee.id = target_employee_id
    and employee.organization_id = target_organization_id;

  if target_profile_id is null then
    raise exception 'Select an employee in this organization.' using errcode = '23503';
  end if;

  if target_profile_id = (select auth.uid()) then
    raise exception 'You cannot change your own role assignments or status.' using errcode = '42501';
  end if;

  select count(*)
  into valid_role_count
  from public.roles role
  where role.organization_id = target_organization_id
    and role.id = any(target_role_ids);

  if valid_role_count <> cardinality(array(select distinct unnest(target_role_ids))) then
    raise exception 'Every assigned role must belong to this organization.' using errcode = '23503';
  end if;

  if exists (
    select 1
    from unnest(target_role_ids) as requested_role_id
    where not (select private.can_grant_role(target_organization_id, requested_role_id))
  ) then
    raise exception 'You cannot assign a role containing permissions you do not hold.' using errcode = '42501';
  end if;

  select count(*)
  into valid_store_count
  from public.stores store
  where store.organization_id = target_organization_id
    and store.id = any(target_store_ids)
    and store.is_active;

  if valid_store_count <> cardinality(array(select distinct unnest(target_store_ids))) then
    raise exception 'Every assigned store must be active and belong to this organization.' using errcode = '23503';
  end if;

  update public.employees
  set
    job_title = normalized_job_title,
    status = normalized_status
  where id = target_employee_id
    and organization_id = target_organization_id;

  delete from public.employee_roles
  where employee_id = target_employee_id
    and organization_id = target_organization_id;

  insert into public.employee_roles (organization_id, employee_id, role_id)
  select target_organization_id, target_employee_id, distinct_role_id
  from unnest(target_role_ids) as distinct_role_id
  on conflict do nothing;

  delete from public.employee_stores
  where employee_id = target_employee_id
    and organization_id = target_organization_id;

  insert into public.employee_stores (organization_id, employee_id, store_id)
  select target_organization_id, target_employee_id, distinct_store_id
  from unnest(target_store_ids) as distinct_store_id
  on conflict do nothing;

  perform private.write_audit_log(
    target_organization_id,
    'EMPLOYEE_ASSIGNMENTS_UPDATED',
    'employees.manage',
    actor_employee_id,
    target_employee_id,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'status', normalized_status,
      'role_ids', target_role_ids,
      'store_ids', target_store_ids
    )
  );

  return target_employee_id;
end;
$$;

revoke execute on function public.update_custom_role(uuid, uuid, text, text, text[])
from public, anon, service_role;
grant execute on function public.update_custom_role(uuid, uuid, text, text, text[])
to authenticated;

revoke execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
from public, anon, service_role;
grant execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
to authenticated;

comment on function public.update_custom_role(uuid, uuid, text, text, text[])
is 'Atomically updates a custom role and its permissions with anti-escalation checks and an audit record.';

comment on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
is 'Atomically updates an employee status, job title, role assignments, and store assignments with anti-escalation checks and an audit record.';

commit;
