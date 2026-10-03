-- TINDIO Final Pre-Production Phase 8: bind offline-sync telemetry to the
-- same store/register as its submitted shift and device. Checkout remains the
-- exactly-once business boundary; this protects its manager-facing audit trail.

begin;

create or replace function public.record_offline_sync_event(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_shift_id uuid,
  target_device_id uuid,
  target_idempotency_key uuid,
  target_local_receipt_reference text,
  target_local_created_at timestamptz,
  target_state text,
  target_conflict_type text,
  target_failure_message text,
  target_official_receipt_number bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  actor_name text;
  selected_store_name text;
  selected_register_name text;
  selected_device_name text;
  normalized_state text := upper(nullif(btrim(coalesce(target_state, '')), ''));
  normalized_conflict_type text := upper(nullif(btrim(coalesce(target_conflict_type, '')), ''));
  normalized_message text := nullif(left(btrim(coalesce(target_failure_message, '')), 1000), '');
  normalized_receipt_reference text := upper(nullif(btrim(coalesce(target_local_receipt_reference, '')), ''));
  event_id uuid;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_idempotency_key is null
    or normalized_receipt_reference is null
    or normalized_receipt_reference !~ '^OFF-[A-Z0-9]{6,32}$'
    or normalized_state not in ('LOCAL_PENDING', 'SYNCING', 'SYNCED', 'CONFLICT', 'FAILED')
    or (normalized_state in ('CONFLICT', 'FAILED') and (
      normalized_conflict_type is null
      or normalized_conflict_type not in (
        'DUPLICATE_TRANSACTION', 'INVALID_SHIFT', 'CLOSED_SHIFT',
        'PRODUCT_ARCHIVED', 'PRICE_CHANGED', 'TAX_CHANGED', 'CUSTOMER_INVALID',
        'INVENTORY_CONFLICT', 'PERMISSION_CHANGED', 'REGISTER_REVOKED', 'DEVICE_REVOKED'
      )
      or normalized_message is null
    )) then
    raise exception 'The offline synchronization event is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required to report offline synchronization.' using errcode = '42501';
  end if;

  select employee.id, coalesce(nullif(profile.full_name, ''), profile.email)
  into actor_employee_id, actor_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  join public.employee_stores employee_store
    on employee_store.organization_id = employee.organization_id
   and employee_store.employee_id = employee.id
   and employee_store.store_id = target_store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active store assignment is required to report offline synchronization.' using errcode = '42501';
  end if;

  select store.name, register.name
  into selected_store_name, selected_register_name
  from public.stores store
  join public.registers register
    on register.id = target_register_id
   and register.organization_id = store.organization_id
   and register.store_id = store.id
  where store.id = target_store_id
    and store.organization_id = target_organization_id;

  if selected_store_name is null then
    raise exception 'The offline sale register is not valid for this organization.' using errcode = '23514';
  end if;

  if target_shift_id is not null and not exists (
    select 1
    from public.shifts shift
    where shift.id = target_shift_id
      and shift.organization_id = target_organization_id
      and shift.store_id = target_store_id
      and shift.register_id = target_register_id
      and shift.opened_by_employee_id = actor_employee_id
  ) then
    raise exception 'The offline sale shift is not valid for this store and register.' using errcode = '23514';
  end if;

  if target_device_id is not null then
    select device.name
    into selected_device_name
    from public.pos_devices device
    where device.id = target_device_id
      and device.organization_id = target_organization_id
      and device.store_id = target_store_id
      and device.register_id = target_register_id;

    if selected_device_name is null then
      raise exception 'The offline sale device is not bound to this store and register.' using errcode = '23514';
    end if;
  end if;

  insert into public.offline_sync_events (
    organization_id, idempotency_key, local_receipt_reference, state,
    conflict_type, failure_message, store_id, register_id, shift_id, device_id,
    employee_id, store_name_snapshot, register_name_snapshot,
    device_name_snapshot, employee_name_snapshot, local_created_at,
    last_attempt_at, attempt_count, official_receipt_number
  ) values (
    target_organization_id, target_idempotency_key, normalized_receipt_reference,
    normalized_state,
    case when normalized_state in ('CONFLICT', 'FAILED') then normalized_conflict_type else null end,
    case when normalized_state in ('CONFLICT', 'FAILED') then normalized_message else null end,
    target_store_id, target_register_id, target_shift_id, target_device_id,
    actor_employee_id, selected_store_name, selected_register_name,
    selected_device_name, actor_name, target_local_created_at,
    now(), 1, target_official_receipt_number
  )
  on conflict (organization_id, idempotency_key) do update
  set
    local_receipt_reference = excluded.local_receipt_reference,
    state = excluded.state,
    conflict_type = excluded.conflict_type,
    failure_message = excluded.failure_message,
    store_id = excluded.store_id,
    register_id = excluded.register_id,
    shift_id = excluded.shift_id,
    device_id = excluded.device_id,
    employee_id = excluded.employee_id,
    store_name_snapshot = excluded.store_name_snapshot,
    register_name_snapshot = excluded.register_name_snapshot,
    device_name_snapshot = excluded.device_name_snapshot,
    employee_name_snapshot = excluded.employee_name_snapshot,
    local_created_at = excluded.local_created_at,
    last_attempt_at = now(),
    attempt_count = public.offline_sync_events.attempt_count + 1,
    official_receipt_number = coalesce(excluded.official_receipt_number, public.offline_sync_events.official_receipt_number)
  returning id into event_id;

  return event_id;
end;
$$;

revoke execute on function public.record_offline_sync_event(uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, bigint) from public, anon, service_role;
grant execute on function public.record_offline_sync_event(uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, bigint) to authenticated;

comment on function public.record_offline_sync_event(uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, bigint) is
  'Records only a validated employee-owned offline checkout sync outcome for manager review, bound to its submitted store and register.';

notify pgrst, 'reload schema';

commit;
