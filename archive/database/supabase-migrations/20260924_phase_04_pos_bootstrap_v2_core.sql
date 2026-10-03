begin;

create or replace function public.get_pos_bootstrap_core_v2(
  target_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  selected_organization_id uuid;
  selected_employee_id uuid;
  selected_employee_number text;
  selected_job_title text;

  permissions text[] := '{}'::text[];
  role_names text[] := '{}'::text[];
  effective_store_ids uuid[] := '{}'::uuid[];

  organization_record record;
  profile_record record;
  active_shift_record record;

  available_organizations jsonb := '[]'::jsonb;
  stores_json jsonb := '[]'::jsonb;
  registers_json jsonb := '[]'::jsonb;
  features_json jsonb := '{}'::jsonb;
begin
  actor_profile_id :=
    private.current_profile_id();

  if actor_profile_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'IDENTITY_UNMAPPED'
    );
  end if;

  select
    profile.full_name,
    profile.email
  into profile_record
  from public.profiles profile
  where profile.id = actor_profile_id;

  if profile_record is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'PROFILE_NOT_FOUND'
    );
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', organization.id,
          'name', organization.name,
          'status', organization.status
        )
        order by
          case when organization.status = 'active' then 0 else 1 end,
          lower(organization.name),
          organization.id
      ),
      '[]'::jsonb
    )
  into available_organizations
  from public.employees employee
  join public.organizations organization
    on organization.id = employee.organization_id
  where employee.profile_id = actor_profile_id
    and employee.status = 'active';

  if jsonb_array_length(available_organizations) = 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NO_ACTIVE_EMPLOYEE'
    );
  end if;

  if target_organization_id is not null then
    select employee.organization_id
    into selected_organization_id
    from public.employees employee
    where employee.profile_id = actor_profile_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
    limit 1;

    if selected_organization_id is null then
      return jsonb_build_object(
        'ok', false,
        'reason', 'ORGANIZATION_FORBIDDEN'
      );
    end if;
  else
    select employee.organization_id
    into selected_organization_id
    from public.employees employee
    join public.organizations organization
      on organization.id = employee.organization_id
    where employee.profile_id = actor_profile_id
      and employee.status = 'active'
    order by
      case when organization.status = 'active' then 0 else 1 end,
      employee.created_at,
      employee.id
    limit 1;
  end if;

  select
    employee.id,
    employee.employee_number,
    employee.job_title
  into
    selected_employee_id,
    selected_employee_number,
    selected_job_title
  from public.employees employee
  where employee.profile_id = actor_profile_id
    and employee.organization_id = selected_organization_id
    and employee.status = 'active'
  order by employee.created_at, employee.id
  limit 1;

  if selected_employee_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NO_ACTIVE_EMPLOYEE'
    );
  end if;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = selected_organization_id;

  if organization_record is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'ORGANIZATION_NOT_FOUND'
    );
  end if;

  select
    coalesce(
      array_agg(distinct role.name order by role.name),
      '{}'::text[]
    )
  into role_names
  from public.employee_roles employee_role
  join public.roles role
    on role.organization_id = employee_role.organization_id
    and role.id = employee_role.role_id
  where employee_role.organization_id = selected_organization_id
    and employee_role.employee_id = selected_employee_id;

  select
    coalesce(
      array_agg(
        distinct role_permission.permission_code
        order by role_permission.permission_code
      ),
      '{}'::text[]
    )
  into permissions
  from public.employee_roles employee_role
  join public.role_permissions role_permission
    on role_permission.organization_id = employee_role.organization_id
    and role_permission.role_id = employee_role.role_id
  where employee_role.organization_id = selected_organization_id
    and employee_role.employee_id = selected_employee_id;

  if 'stores.manage' = any(permissions) then
    select
      coalesce(
        array_agg(store.id order by store.created_at, store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.stores store
    where store.organization_id = selected_organization_id
      and store.is_active;
  else
    select
      coalesce(
        array_agg(distinct store.id order by store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.employee_stores assignment
    join public.stores store
      on store.organization_id = assignment.organization_id
      and store.id = assignment.store_id
      and store.is_active
    where assignment.organization_id = selected_organization_id
      and assignment.employee_id = selected_employee_id;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', store.id,
          'name', store.name
        )
        order by store.created_at, store.id
      ),
      '[]'::jsonb
    )
  into stores_json
  from public.stores store
  where store.organization_id = selected_organization_id
    and store.id = any(effective_store_ids)
    and store.is_active;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', register.id,
          'storeId', register.store_id,
          'name', register.name,
          'code', register.code
        )
        order by register.name, register.id
      ),
      '[]'::jsonb
    )
  into registers_json
  from public.registers register
  where register.organization_id = selected_organization_id
    and register.store_id = any(effective_store_ids)
    and register.is_active;

  select
    coalesce(
      jsonb_object_agg(
        feature.feature_key,
        feature.is_enabled
      ),
      '{}'::jsonb
    )
  into features_json
  from public.organization_features feature
  where feature.organization_id = selected_organization_id;

  select
    shift.id,
    shift.store_id,
    shift.register_id,
    shift.opening_cash_minor,
    shift.opened_at
  into active_shift_record
  from public.shifts shift
  where shift.organization_id = selected_organization_id
    and shift.opened_by_employee_id = selected_employee_id
    and shift.status = 'open'
    and shift.store_id = any(effective_store_ids)
  order by shift.opened_at desc, shift.id
  limit 1;

  return jsonb_build_object(
    'ok', true,

    'profileId',
      actor_profile_id,

    'organization',
      jsonb_build_object(
        'id', organization_record.id,
        'name', organization_record.name,
        'currencyCode', organization_record.currency_code,
        'timezone', organization_record.timezone,
        'status', organization_record.status,
        'businessType', organization_record.business_type,
        'deviceManagementEnabled',
          organization_record.device_management_enabled
      ),

    'employee',
      jsonb_build_object(
        'id', selected_employee_id,
        'employeeNumber', selected_employee_number,
        'jobTitle', selected_job_title,
        'name',
          coalesce(
            nullif(profile_record.full_name, ''),
            profile_record.email,
            selected_employee_number
          )
      ),

    'availableOrganizations',
      available_organizations,

    'roleNames',
      to_jsonb(role_names),

    'permissions',
      to_jsonb(permissions),

    'storeIds',
      to_jsonb(effective_store_ids),

    'stores',
      stores_json,

    'registers',
      registers_json,

    'features',
      features_json,

    'activeShift',
      case
        when active_shift_record.id is null
          then null
        else jsonb_build_object(
          'id', active_shift_record.id,
          'storeId', active_shift_record.store_id,
          'registerId', active_shift_record.register_id,
          'openingCashMinor', active_shift_record.opening_cash_minor,
          'openedAt', active_shift_record.opened_at
        )
      end
  );
end;
$$;

revoke all
on function public.get_pos_bootstrap_core_v2(uuid)
from public, anon, service_role;

grant execute
on function public.get_pos_bootstrap_core_v2(uuid)
to authenticated;

comment on function public.get_pos_bootstrap_core_v2(uuid)
is
'POS V2 core bootstrap. Resolves provider-neutral identity, organization membership, RBAC, effective store scope, stores, registers, organization features, and active shift in one read-only RPC. Caller cannot provide profile or employee identity.';

notify pgrst, 'reload schema';

commit;
