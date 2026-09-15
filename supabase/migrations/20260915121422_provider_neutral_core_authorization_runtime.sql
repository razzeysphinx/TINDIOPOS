-- TINDIO R3.5
-- Provider-neutral core authorization runtime.
--
-- IMPORTANT:
-- These definitions preserve the latest runtime semantics introduced by:
-- - multi-tenant readiness
-- - permission NULL safety
-- - multi-store reporting scope
-- - granular inventory RBAC
-- - manager approval infrastructure
--
-- Only identity resolution changes.
--
-- Business authorization now resolves the permanent TINDIO profile through
-- private.current_profile_id() instead of treating the external provider
-- subject as a TINDIO profile ID.

create or replace function private.current_employee_id(
  target_organization_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select employee.id
  from public.employees employee
  join public.organizations organization
    on organization.id = employee.organization_id
   and organization.status = 'active'
  where employee.organization_id = target_organization_id
    and employee.profile_id =
      (select private.current_profile_id())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;
$$;

create or replace function private.is_organization_creator(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.current_profile_id()) is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.created_by =
          (select private.current_profile_id())
        and organization.status = 'active'
    ),
    false
  );
$$;

create or replace function private.is_organization_member(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.current_profile_id()) is not null
    and exists (
      select 1
      from public.employees employee
      join public.organizations organization
        on organization.id = employee.organization_id
       and organization.status = 'active'
      where employee.organization_id = target_organization_id
        and employee.profile_id =
          (select private.current_profile_id())
        and employee.status = 'active'
    );
$$;

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
    (select private.current_profile_id()) is not null
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
          and employee.profile_id =
            (select private.current_profile_id())
          and employee.status = 'active'
          and role_permission.permission_code = requested_permission
      )
      or (
        current_setting(
          'tindio.approval_profile_id',
          true
        ) =
          (select private.current_profile_id())::text

        and current_setting(
          'tindio.approval_organization_id',
          true
        ) = target_organization_id::text

        and current_setting(
          'tindio.approval_permission',
          true
        ) = requested_permission
      )
    ),
    false
  );
$$;

create or replace function private.can_view_employee_profile(
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_profile_id =
      (select private.current_profile_id())

    or exists (
      select 1
      from public.employees target_employee
      where target_employee.profile_id = target_profile_id

        and (
          select private.has_permission(
            target_employee.organization_id,
            'employees.manage'
          )
        )

        and (
          select private.can_access_employee_store_scope(
            target_employee.organization_id,
            target_employee.id
          )
        )
    );
$$;

-- Manager approval must store the permanent TINDIO profile identity in its
-- transaction-local authorization context.
--
-- All approval lifecycle, idempotency, auditing, status, payload, employee,
-- and expiry behavior remains unchanged.

create or replace function private.activate_manager_approval(
  target_organization_id uuid,
  target_approval_request_id uuid,
  target_operation_code text,
  target_expected_payload jsonb,
  target_execution_idempotency_key uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  request public.approval_requests%rowtype;
  required_permission text;
begin
  actor_employee_id :=
    private.current_employee_id(target_organization_id);

  if actor_employee_id is null then
    raise exception
      'An active employee is required.'
      using errcode = '42501';
  end if;

  select *
  into request
  from public.approval_requests approval_request
  where approval_request.id = target_approval_request_id
    and approval_request.organization_id =
      target_organization_id
  for update;

  if request.id is null
    or request.requested_by_employee_id
      is distinct from actor_employee_id
    or request.operation_code
      is distinct from target_operation_code
    or request.request_payload
      is distinct from target_expected_payload
  then
    raise exception
      'The manager approval does not match this operation.'
      using errcode = '42501';
  end if;

  required_permission :=
    private.approval_operation_permission(
      target_operation_code
    );

  if required_permission is null then
    raise exception
      'This approval operation is not supported.'
      using errcode = '23514';
  end if;

  if request.status = 'CONSUMED' then

    if target_execution_idempotency_key is null
      or request.execution_idempotency_key
        is distinct from target_execution_idempotency_key
    then
      raise exception
        'This manager approval was already used.'
        using errcode = '23514';
    end if;

  elsif request.status = 'APPROVED'
    and request.expires_at > now()
  then

    update public.approval_requests
    set
      status = 'CONSUMED',
      consumed_at = now(),
      execution_idempotency_key =
        target_execution_idempotency_key,
      updated_at = now()
    where id = request.id
      and organization_id = request.organization_id;

    perform private.write_audit_log(
      target_organization_id,
      'APPROVAL_CONSUMED',
      target_operation_code,
      actor_employee_id,
      request.approved_by_employee_id,
      request.store_id,
      request.register_id,
      request.id,
      request.requested_amount_minor,
      request.reason,
      '{}'::jsonb
    );

  else

    raise exception
      'The manager approval is no longer valid.'
      using errcode = '42501';

  end if;

  perform set_config(
    'tindio.approval_profile_id',
    (select private.current_profile_id())::text,
    true
  );

  perform set_config(
    'tindio.approval_organization_id',
    target_organization_id::text,
    true
  );

  perform set_config(
    'tindio.approval_permission',
    required_permission,
    true
  );
end;
$$;

-- Preserve the existing callable authorization surface.

revoke execute
on function private.current_employee_id(uuid)
from public, anon, authenticated, service_role;

revoke execute
on function private.is_organization_creator(uuid)
from public, anon, authenticated, service_role;

revoke execute
on function private.is_organization_member(uuid)
from public, anon, authenticated, service_role;

revoke execute
on function private.has_permission(uuid, text)
from public, anon, authenticated, service_role;

revoke execute
on function private.can_view_employee_profile(uuid)
from public, anon, authenticated, service_role;

revoke execute
on function private.activate_manager_approval(
  uuid,
  uuid,
  text,
  jsonb,
  uuid
)
from public, anon, authenticated, service_role;

grant usage
on schema private
to authenticated;

grant execute
on function private.current_employee_id(uuid)
to authenticated;

grant execute
on function private.is_organization_creator(uuid)
to authenticated;

grant execute
on function private.is_organization_member(uuid)
to authenticated;

grant execute
on function private.has_permission(uuid, text)
to authenticated;

grant execute
on function private.can_view_employee_profile(uuid)
to authenticated;

-- activate_manager_approval intentionally remains internal.
-- Do NOT grant it directly to authenticated callers.
