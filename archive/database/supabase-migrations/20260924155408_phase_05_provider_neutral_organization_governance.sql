-- Phase 05B: organization governance must resolve the stable TINDIO profile
-- through the provider-neutral identity boundary.  The business rules below
-- intentionally retain the established authorization, rate-limit, export, and
-- archive behavior; only the provider-specific subject lookup is removed.

begin;

create or replace function private.has_organization_export_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    private.current_profile_id() is not null
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
        and employee.profile_id = private.current_profile_id()
        and employee.status = 'active'
        and role_permission.permission_code = 'organization.export'
    ),
    false
  );
$function$;

create or replace function private.has_organization_lifecycle_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    private.current_profile_id() is not null
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
        and employee.profile_id = private.current_profile_id()
        and employee.status = 'active'
        and role_permission.permission_code in (
          'organization.archive',
          'organization.lifecycle'
        )
      group by employee.id
      having count(distinct role_permission.permission_code) = 2
    ),
    false
  );
$function$;

create or replace function private.has_organization_recovery_view_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    private.current_profile_id() is not null
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
        and employee.profile_id = private.current_profile_id()
        and employee.status = 'active'
        and role_permission.permission_code in (
          'recovery.view',
          'recovery.manage'
        )
    ),
    false
  );
$function$;

create or replace function private.has_organization_recovery_manage_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    private.current_profile_id() is not null
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
        and employee.profile_id = private.current_profile_id()
        and employee.status = 'active'
        and role_permission.permission_code = 'recovery.manage'
    ),
    false
  );
$function$;

create or replace function private.current_organization_member_employee_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select employee.id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = private.current_profile_id()
    and employee.status = 'active'
  order by employee.created_at
  limit 1;
$function$;

create or replace function private.consume_organization_rate_limit(
  target_organization_id uuid,
  target_action_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_action_code text :=
    lower(btrim(coalesce(target_action_code, '')));
  configured_limit integer;
  current_profile_id uuid := private.current_profile_id();
  current_window_start timestamptz :=
    date_trunc('hour', clock_timestamp());
  current_window_ends_at timestamptz;
  observed_request_count integer;
  request_was_allowed boolean := false;
begin
  if current_profile_id is null then
    raise exception
      'An authenticated TINDIO profile is required.'
      using errcode = '42501';
  end if;

  case normalized_action_code
    when 'organization.export' then
      configured_limit := 3;

      if not private.has_organization_export_access(
        target_organization_id
      ) then
        raise exception
          'You do not have permission to export this organization.'
          using errcode = '42501';
      end if;

    when 'organization.lifecycle' then
      configured_limit := 10;

      if not private.has_organization_lifecycle_access(
        target_organization_id
      ) then
        raise exception
          'Only an organization owner can change this lifecycle.'
          using errcode = '42501';
      end if;

    when 'organization.recovery_drill' then
      configured_limit := 10;

      if not private.has_organization_recovery_manage_access(
        target_organization_id
      ) then
        raise exception
          'Only an owner can record a recovery drill.'
          using errcode = '42501';
      end if;

    else
      raise exception
        'Unsupported organization rate-limit action.'
        using errcode = '22023';
  end case;

  current_window_ends_at :=
    current_window_start + interval '1 hour';

  delete from public.organization_rate_limit_windows rate_window
  where rate_window.window_started_at
    < current_window_start - interval '2 days';

  observed_request_count := null;

  insert into public.organization_rate_limit_windows (
    organization_id,
    profile_id,
    action_code,
    window_started_at,
    request_count
  )
  values (
    target_organization_id,
    current_profile_id,
    normalized_action_code,
    current_window_start,
    1
  )
  on conflict (
    organization_id,
    profile_id,
    action_code,
    window_started_at
  )
  do update
    set
      request_count =
        public.organization_rate_limit_windows.request_count + 1,
      updated_at = clock_timestamp()
  where public.organization_rate_limit_windows.request_count
    < configured_limit
  returning request_count
  into observed_request_count;

  request_was_allowed :=
    observed_request_count is not null;

  if not request_was_allowed then
    select rate_window.request_count
    into observed_request_count
    from public.organization_rate_limit_windows rate_window
    where rate_window.organization_id = target_organization_id
      and rate_window.profile_id = current_profile_id
      and rate_window.action_code = normalized_action_code
      and rate_window.window_started_at = current_window_start;

    if observed_request_count is null then
      raise exception
        'The organization rate-limit window could not be resolved.'
        using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'allowed', request_was_allowed,
    'limit', configured_limit,
    'remaining', greatest(configured_limit - observed_request_count, 0),
    'retry_after_seconds', greatest(
      floor(extract(
        epoch from (current_window_ends_at - clock_timestamp())
      ))::integer,
      0
    )
  );
end;
$function$;

create or replace function private.prepare_organization_export(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  rate_limit_result jsonb;
  export_session_id uuid;
  actor_employee_id uuid;
  current_profile_id uuid := private.current_profile_id();
begin
  rate_limit_result := private.consume_organization_rate_limit(
    target_organization_id,
    'organization.export'
  );

  if not coalesce((rate_limit_result ->> 'allowed')::boolean, false) then
    return rate_limit_result;
  end if;

  delete from public.organization_export_sessions session
  where session.expires_at <= now();

  insert into public.organization_export_sessions (
    organization_id,
    profile_id,
    expires_at
  )
  values (
    target_organization_id,
    current_profile_id,
    now() + interval '1 hour'
  )
  returning id into export_session_id;

  actor_employee_id :=
    private.current_organization_member_employee_id(
      target_organization_id
    );

  perform private.write_audit_log(
    target_organization_id,
    'ORGANIZATION_EXPORT_PREPARED',
    'organization.export',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('expires_at', now() + interval '1 hour')
  );

  return rate_limit_result || jsonb_build_object(
    'export_session_id', export_session_id,
    'expires_at', now() + interval '1 hour'
  );
end;
$function$;

create or replace function public.get_organization_export_page(
  target_export_session_id uuid,
  target_section text,
  target_after_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  export_session public.organization_export_sessions%rowtype;
  normalized_section text := lower(btrim(coalesce(target_section, '')));
  source_table text;
  source_predicate text;
  export_rows jsonb;
  next_after_id uuid;
  current_profile_id uuid := private.current_profile_id();
begin
  select session.*
  into export_session
  from public.organization_export_sessions session
  where session.id = target_export_session_id
    and session.profile_id = current_profile_id
    and session.expires_at > now();

  if not found then
    raise exception 'The organization export session is missing or has expired.' using errcode = '42501';
  end if;

  if not private.has_organization_export_access(export_session.organization_id) then
    raise exception 'You do not have permission to export this organization.' using errcode = '42501';
  end if;

  case normalized_section
    when 'organization' then source_table := 'public.organizations'; source_predicate := 'id = $1';
    when 'stores' then source_table := 'public.stores'; source_predicate := 'organization_id = $1';
    when 'registers' then source_table := 'public.registers'; source_predicate := 'organization_id = $1';
    when 'employees' then source_table := 'public.employees'; source_predicate := 'organization_id = $1';
    when 'roles' then source_table := 'public.roles'; source_predicate := 'organization_id = $1';
    when 'categories' then source_table := 'public.categories'; source_predicate := 'organization_id = $1';
    when 'products' then source_table := 'public.products'; source_predicate := 'organization_id = $1';
    when 'product_variants' then source_table := 'public.product_variants'; source_predicate := 'organization_id = $1';
    when 'customers' then source_table := 'public.customers'; source_predicate := 'organization_id = $1';
    when 'payment_methods' then source_table := 'public.payment_methods'; source_predicate := 'organization_id = $1';
    when 'sales' then source_table := 'public.sales'; source_predicate := 'organization_id = $1';
    when 'sale_items' then source_table := 'public.sale_items'; source_predicate := 'organization_id = $1';
    when 'payments' then source_table := 'public.payments'; source_predicate := 'organization_id = $1';
    when 'receipts' then source_table := 'public.receipts'; source_predicate := 'organization_id = $1';
    when 'refunds' then source_table := 'public.refunds'; source_predicate := 'organization_id = $1';
    when 'inventory_movements' then source_table := 'public.inventory_movements'; source_predicate := 'organization_id = $1';
    when 'purchase_orders' then source_table := 'public.purchase_orders'; source_predicate := 'organization_id = $1';
    when 'stock_transfers' then source_table := 'public.stock_transfers'; source_predicate := 'organization_id = $1';
    when 'offline_sync_events' then source_table := 'public.offline_sync_events'; source_predicate := 'organization_id = $1';
    else
      raise exception 'Unsupported organization export section.' using errcode = '22023';
  end case;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(export_row)), ''[]''::jsonb)
       from (
         select *
         from %s
         where %s
           and ($2::uuid is null or id > $2::uuid)
         order by id
         limit 250
       ) export_row',
    source_table,
    source_predicate
  )
  into export_rows
  using export_session.organization_id, target_after_id;

  if jsonb_array_length(export_rows) = 250 then
    next_after_id := (export_rows -> 249 ->> 'id')::uuid;
  end if;

  return jsonb_build_object(
    'records', export_rows,
    'next_after_id', next_after_id
  );
end;
$function$;

create or replace function private.complete_organization_export(
  target_export_session_id uuid,
  target_record_count integer,
  target_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  export_session public.organization_export_sessions%rowtype;
  actor_employee_id uuid;
  delivery_completed_at timestamptz := clock_timestamp();
  current_profile_id uuid := private.current_profile_id();
begin
  if target_record_count not between 1 and 50000000
    or jsonb_typeof(target_manifest) <> 'object'
    or not (target_manifest ? 'format')
    or not (target_manifest ? 'sections') then
    raise exception 'Export delivery details are invalid.' using errcode = '22023';
  end if;

  select session.*
  into export_session
  from public.organization_export_sessions session
  where session.id = target_export_session_id
    and session.profile_id = current_profile_id
    and session.expires_at > now()
  for update;

  if not found then
    raise exception 'The organization export session is missing or has expired.' using errcode = '42501';
  end if;

  if not private.has_organization_export_access(export_session.organization_id) then
    raise exception 'You do not have permission to export this organization.' using errcode = '42501';
  end if;

  if export_session.delivered_at is not null then
    return jsonb_build_object(
      'export_session_id', export_session.id,
      'delivered_at', export_session.delivered_at,
      'record_count', export_session.delivered_record_count,
      'was_replayed', true
    );
  end if;

  update public.organization_export_sessions session
  set
    delivered_at = delivery_completed_at,
    delivered_record_count = target_record_count,
    delivery_manifest = target_manifest
  where session.id = export_session.id;

  actor_employee_id := private.current_organization_member_employee_id(
    export_session.organization_id
  );

  perform private.write_audit_log(
    export_session.organization_id,
    'ORGANIZATION_EXPORT_DELIVERED',
    'organization.export',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'export_session_id', export_session.id,
      'record_count', target_record_count,
      'format', target_manifest ->> 'format'
    )
  );

  return jsonb_build_object(
    'export_session_id', export_session.id,
    'delivered_at', delivery_completed_at,
    'record_count', target_record_count,
    'was_replayed', false
  );
end;
$function$;

create or replace function private.manage_organization_lifecycle(
  target_organization_id uuid,
  target_action text,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_action text := upper(btrim(coalesce(target_action, '')));
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  organization_record public.organizations%rowtype;
  actor_employee_id uuid;
  rate_limit_result jsonb;
begin
  if not private.has_organization_lifecycle_access(target_organization_id) then
    raise exception 'Only an organization owner can change this lifecycle.' using errcode = '42501';
  end if;

  rate_limit_result := private.consume_organization_rate_limit(
    target_organization_id,
    'organization.lifecycle'
  );

  if not coalesce((rate_limit_result ->> 'allowed')::boolean, false) then
    return rate_limit_result;
  end if;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = target_organization_id
  for update;

  if not found then
    raise exception 'Organization was not found.' using errcode = 'P0002';
  end if;

  actor_employee_id := private.current_organization_member_employee_id(
    target_organization_id
  );

  if actor_employee_id is null then
    raise exception
      'An active organization employee is required.'
      using errcode = '42501';
  end if;

  if normalized_action in ('SUSPEND', 'REQUEST_ARCHIVE')
    and (normalized_reason is null or char_length(normalized_reason) not between 3 and 500) then
    raise exception 'Provide a reason between 3 and 500 characters.' using errcode = '22023';
  end if;

  if organization_record.status = 'archived' and normalized_action <> 'ARCHIVE' then
    raise exception 'Archived organizations are retained and cannot be reactivated.' using errcode = '22023';
  end if;

  case normalized_action
    when 'SUSPEND' then
      if organization_record.status = 'suspended' then
        raise exception 'This organization is already suspended.' using errcode = '22023';
      end if;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_SUSPENDED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, normalized_reason,
        jsonb_build_object('previous_status', organization_record.status)
      );

      update public.organizations organization
      set status = 'suspended',
          suspended_at = now(),
          suspension_reason = normalized_reason
      where organization.id = target_organization_id;

    when 'RESUME' then
      if organization_record.status <> 'suspended' then
        raise exception 'Only a suspended organization can be resumed.' using errcode = '22023';
      end if;

      update public.organizations organization
      set status = 'active',
          suspended_at = null,
          suspension_reason = null
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_RESUMED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, null,
        jsonb_build_object('previous_status', organization_record.status)
      );

    when 'REQUEST_ARCHIVE' then
      if organization_record.archive_requested_at is not null then
        raise exception 'An archive request is already open for this organization.' using errcode = '22023';
      end if;

      update public.organizations organization
      set archive_requested_at = clock_timestamp(),
          archive_requested_by_employee_id = actor_employee_id
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVE_REQUESTED', 'organization.lifecycle', actor_employee_id,
        null, null, null, null, null, normalized_reason,
        jsonb_build_object('status', organization_record.status)
      );

    when 'CANCEL_ARCHIVE' then
      if organization_record.archive_requested_at is null then
        raise exception 'There is no archive request to cancel.' using errcode = '22023';
      end if;

      update public.organizations organization
      set archive_requested_at = null,
          archive_requested_by_employee_id = null
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVE_CANCELLED', 'organization.lifecycle', actor_employee_id,
        null, null, null, null, null, null,
        '{}'::jsonb
      );

    when 'ARCHIVE' then
      if organization_record.archive_requested_at is null then
        raise exception 'Request an archive and download an export before archiving this organization.' using errcode = '22023';
      end if;

      -- organizations_archive_export_delivered verifies that a fresh export
      -- was delivered after this request before this status can be changed.
      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, null,
        jsonb_build_object('archive_requested_at', organization_record.archive_requested_at)
      );

      update public.organizations organization
      set status = 'archived',
          archived_at = now(),
          suspended_at = null,
          suspension_reason = null
      where organization.id = target_organization_id;

    else
      raise exception 'Unsupported organization lifecycle action.' using errcode = '22023';
  end case;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = target_organization_id;

  return rate_limit_result || jsonb_build_object(
    'status', organization_record.status,
    'suspended_at', organization_record.suspended_at,
    'archive_requested_at', organization_record.archive_requested_at,
    'archived_at', organization_record.archived_at
  );
end;
$function$;

revoke execute on function private.has_organization_export_access(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.has_organization_lifecycle_access(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.has_organization_recovery_view_access(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.has_organization_recovery_manage_access(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.current_organization_member_employee_id(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.consume_organization_rate_limit(uuid,text)
  from public, anon, authenticated, service_role;
revoke execute on function private.prepare_organization_export(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.complete_organization_export(uuid,integer,jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.manage_organization_lifecycle(uuid,text,text)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
