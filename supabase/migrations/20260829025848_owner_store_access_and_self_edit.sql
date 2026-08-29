-- Keep organization-level operators assigned to every active store without
-- coupling access to a preset role name. The organization.manage capability is
-- the authoritative signal for organization-wide operational scope.
begin;

create or replace function private.sync_organization_manager_store_access(
  target_organization_id uuid,
  target_employee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employee_stores (organization_id, employee_id, store_id)
  select
    employee.organization_id,
    employee.id,
    store.id
  from public.employees employee
  join public.stores store
    on store.organization_id = employee.organization_id
   and store.is_active
  where employee.organization_id = target_organization_id
    and employee.status = 'active'
    and (target_employee_id is null or employee.id = target_employee_id)
    and exists (
      select 1
      from public.employee_roles employee_role
      join public.role_permissions role_permission
        on role_permission.organization_id = employee_role.organization_id
       and role_permission.role_id = employee_role.role_id
      where employee_role.organization_id = employee.organization_id
        and employee_role.employee_id = employee.id
        and role_permission.permission_code = 'organization.manage'
    )
  on conflict (employee_id, store_id) do nothing;
end;
$$;

revoke execute on function private.sync_organization_manager_store_access(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.skip_duplicate_employee_store_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.employee_stores employee_store
    where employee_store.employee_id = new.employee_id
      and employee_store.store_id = new.store_id
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke execute on function private.skip_duplicate_employee_store_assignment()
from public, anon, authenticated, service_role;

create or replace function private.sync_organization_manager_store_access_from_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_organization_manager_store_access(new.organization_id);
  return new;
end;
$$;

create or replace function private.sync_organization_manager_store_access_from_employee_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- bootstrap_organization explicitly creates the first employee-store row
  -- after assigning the initial Owner role. Waiting until a business has a
  -- second active store avoids racing that bootstrap insert while still giving
  -- newly assigned organization managers full multi-store access.
  if (
    select count(*)
    from public.stores store
    where store.organization_id = new.organization_id
      and store.is_active
  ) > 1 then
    perform private.sync_organization_manager_store_access(new.organization_id, new.employee_id);
  end if;
  return new;
end;
$$;

create or replace function private.sync_organization_manager_store_access_from_role_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.permission_code = 'organization.manage' then
    perform private.sync_organization_manager_store_access(new.organization_id);
  end if;
  return new;
end;
$$;

create or replace function private.sync_organization_manager_store_access_from_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform private.sync_organization_manager_store_access(new.organization_id, new.id);
  end if;
  return new;
end;
$$;

revoke execute on function private.sync_organization_manager_store_access_from_store()
from public, anon, authenticated, service_role;
revoke execute on function private.sync_organization_manager_store_access_from_employee_role()
from public, anon, authenticated, service_role;
revoke execute on function private.sync_organization_manager_store_access_from_role_permission()
from public, anon, authenticated, service_role;
revoke execute on function private.sync_organization_manager_store_access_from_employee()
from public, anon, authenticated, service_role;

create trigger stores_assign_organization_managers
after insert on public.stores
for each row execute function private.sync_organization_manager_store_access_from_store();

create trigger employee_stores_skip_duplicate_assignment
before insert on public.employee_stores
for each row execute function private.skip_duplicate_employee_store_assignment();

create trigger employee_roles_assign_organization_manager_stores
after insert on public.employee_roles
for each row execute function private.sync_organization_manager_store_access_from_employee_role();

create trigger role_permissions_assign_organization_manager_stores
after insert on public.role_permissions
for each row execute function private.sync_organization_manager_store_access_from_role_permission();

create trigger employees_assign_organization_manager_stores
after insert or update of status on public.employees
for each row execute function private.sync_organization_manager_store_access_from_employee();

-- Repair every existing organization so current owners receive every active
-- store as soon as this migration is applied.
select private.sync_organization_manager_store_access(organization.id)
from public.organizations organization;

-- Owners may update their own non-security details from the employee workspace,
-- but cannot change their own status or role bundle. Their store assignments are
-- always reconciled from the organization.manage capability after the update.
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
  current_status text;
  current_role_ids uuid[];
  requested_role_ids uuid[];
  effective_store_ids uuid[];
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

  select employee.profile_id, employee.status
  into target_profile_id, current_status
  from public.employees employee
  where employee.id = target_employee_id
    and employee.organization_id = target_organization_id;

  if target_profile_id is null then
    raise exception 'Select an employee in this organization.' using errcode = '23503';
  end if;

  select coalesce(array_agg(employee_role.role_id order by employee_role.role_id), '{}'::uuid[])
  into current_role_ids
  from public.employee_roles employee_role
  where employee_role.organization_id = target_organization_id
    and employee_role.employee_id = target_employee_id;

  select coalesce(array_agg(distinct requested_role_id order by requested_role_id), '{}'::uuid[])
  into requested_role_ids
  from unnest(target_role_ids) as requested_role_id;

  if target_profile_id = (select auth.uid()) then
    if not (select private.has_permission(target_organization_id, 'organization.manage')) then
      raise exception 'Only organization managers can update their own employee record.' using errcode = '42501';
    end if;

    if normalized_status is distinct from current_status
      or requested_role_ids is distinct from current_role_ids then
      raise exception 'You cannot change your own role assignments or status.' using errcode = '42501';
    end if;
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

  perform private.sync_organization_manager_store_access(
    target_organization_id,
    target_employee_id
  );

  select coalesce(array_agg(employee_store.store_id order by employee_store.store_id), '{}'::uuid[])
  into effective_store_ids
  from public.employee_stores employee_store
  where employee_store.organization_id = target_organization_id
    and employee_store.employee_id = target_employee_id;

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
      'role_ids', requested_role_ids,
      'store_ids', effective_store_ids,
      'requested_store_ids', target_store_ids
    )
  );

  return target_employee_id;
end;
$$;

revoke execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
from public, anon, service_role;
grant execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
to authenticated;

comment on function private.sync_organization_manager_store_access(uuid, uuid)
is 'Internal capability-based assignment of every active store to active employees holding organization.manage.';

comment on function private.skip_duplicate_employee_store_assignment()
is 'Makes repeated employee-store assignments idempotent so automatic organization-manager access coexists with legacy assignment flows.';

comment on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
is 'Atomically updates employee assignments, permits safe organization-manager self edits, and preserves organization-wide store access.';

commit;
