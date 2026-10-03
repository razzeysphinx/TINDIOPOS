-- TINDIO Improvement Phase 13: durable offline POS synchronization.
--
-- Offline sales remain browser-local until a signed-in POS reconnects. This
-- migration records only server-observed outcomes: confirmed synchronizations
-- and deterministic conflicts that a manager needs to resolve. The normal
-- checkout idempotency key remains the exactly-once boundary.

begin;

alter table public.payment_methods
  add column if not exists offline_policy text not null default 'disabled';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_methods_offline_policy_values'
      and conrelid = 'public.payment_methods'::regclass
  ) then
    alter table public.payment_methods
      add constraint payment_methods_offline_policy_values
      check (offline_policy in ('disabled', 'cash', 'manual_external'));
  end if;
end;
$$;

-- Cash is the only automatic offline settlement policy. A manager can opt in
-- a manual-external method for future controlled workflows, but it is never
-- treated as gateway-confirmed by the POS.
update public.payment_methods
set offline_policy = 'cash'
where payment_type = 'CASH'
  and offline_policy = 'disabled';

create or replace function private.default_cash_offline_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_type = 'CASH' and new.offline_policy = 'disabled' then
    new.offline_policy := 'cash';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_methods_default_cash_offline_policy on public.payment_methods;
create trigger payment_methods_default_cash_offline_policy
before insert on public.payment_methods
for each row execute function private.default_cash_offline_policy();

create table public.offline_sync_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  idempotency_key uuid not null,
  local_receipt_reference text not null,
  state text not null,
  conflict_type text,
  failure_message text,
  store_id uuid not null,
  register_id uuid not null,
  shift_id uuid,
  device_id uuid,
  employee_id uuid not null,
  store_name_snapshot text not null,
  register_name_snapshot text not null,
  device_name_snapshot text,
  employee_name_snapshot text not null,
  local_created_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 1,
  official_receipt_number bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_sync_events_organization_key_unique unique (organization_id, idempotency_key),
  constraint offline_sync_events_local_receipt_reference_format check (
    local_receipt_reference ~ '^OFF-[A-Z0-9]{6,32}$'
  ),
  constraint offline_sync_events_state_values check (
    state in ('LOCAL_PENDING', 'SYNCING', 'SYNCED', 'CONFLICT', 'FAILED')
  ),
  constraint offline_sync_events_conflict_type_values check (
    conflict_type is null or conflict_type in (
      'DUPLICATE_TRANSACTION', 'INVALID_SHIFT', 'CLOSED_SHIFT',
      'PRODUCT_ARCHIVED', 'PRICE_CHANGED', 'TAX_CHANGED', 'CUSTOMER_INVALID',
      'INVENTORY_CONFLICT', 'PERMISSION_CHANGED', 'REGISTER_REVOKED',
      'DEVICE_REVOKED'
    )
  ),
  constraint offline_sync_events_failure_state check (
    (state in ('CONFLICT', 'FAILED') and conflict_type is not null and failure_message is not null)
    or state not in ('CONFLICT', 'FAILED')
  ),
  constraint offline_sync_events_attempt_count_positive check (attempt_count > 0),
  constraint offline_sync_events_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint offline_sync_events_register_organization_fkey foreign key (register_id, organization_id)
    references public.registers (id, organization_id) on delete restrict,
  constraint offline_sync_events_shift_organization_fkey foreign key (shift_id, organization_id)
    references public.shifts (id, organization_id) on delete restrict,
  constraint offline_sync_events_device_organization_fkey foreign key (device_id, organization_id)
    references public.pos_devices (id, organization_id) on delete restrict,
  constraint offline_sync_events_employee_organization_fkey foreign key (employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict
);

create index offline_sync_events_organization_state_attempt_idx
  on public.offline_sync_events (organization_id, state, last_attempt_at desc);
create index offline_sync_events_store_register_state_idx
  on public.offline_sync_events (store_id, register_id, state, last_attempt_at desc);
create index offline_sync_events_employee_attempt_idx
  on public.offline_sync_events (employee_id, last_attempt_at desc);
create index offline_sync_events_shift_id_idx
  on public.offline_sync_events (shift_id)
  where shift_id is not null;
create index offline_sync_events_device_id_idx
  on public.offline_sync_events (device_id)
  where device_id is not null;

alter table public.offline_sync_events enable row level security;
revoke all on table public.offline_sync_events from public, anon, authenticated, service_role;
grant select on table public.offline_sync_events to authenticated;

create policy offline_sync_events_select_device_managers
on public.offline_sync_events for select
to authenticated
using ((select private.has_permission(organization_id, 'devices.manage')));

create trigger offline_sync_events_set_updated_at
before update on public.offline_sync_events
for each row execute function private.set_updated_at();

create or replace function public.set_payment_method_offline_policy(
  target_organization_id uuid,
  target_payment_method_id uuid,
  target_offline_policy text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_payment_type text;
  normalized_policy text := lower(nullif(btrim(coalesce(target_offline_policy, '')), ''));
begin
  if target_organization_id is null
    or target_payment_method_id is null
    or normalized_policy not in ('disabled', 'cash', 'manual_external') then
    raise exception 'Choose a valid offline payment policy.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to change offline payment policies.'
      using errcode = '42501';
  end if;

  select payment_method.payment_type
  into selected_payment_type
  from public.payment_methods payment_method
  where payment_method.id = target_payment_method_id
    and payment_method.organization_id = target_organization_id
  for update;

  if selected_payment_type is null then
    raise exception 'The payment method was not found in this organization.' using errcode = 'P0002';
  end if;

  if normalized_policy = 'cash' and selected_payment_type <> 'CASH' then
    raise exception 'Only cash methods can be settled automatically while offline.' using errcode = '23514';
  end if;

  if normalized_policy = 'manual_external' and selected_payment_type = 'CASH' then
    raise exception 'Cash methods use either the cash policy or disabled policy.' using errcode = '23514';
  end if;

  update public.payment_methods payment_method
  set offline_policy = normalized_policy
  where payment_method.id = target_payment_method_id
    and payment_method.organization_id = target_organization_id;

  return true;
end;
$$;

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
    select 1 from public.shifts shift
    where shift.id = target_shift_id and shift.organization_id = target_organization_id
  ) then
    raise exception 'The offline sale shift is not valid for this organization.' using errcode = '23514';
  end if;

  if target_device_id is not null then
    select device.name
    into selected_device_name
    from public.pos_devices device
    where device.id = target_device_id
      and device.organization_id = target_organization_id;

    if selected_device_name is null then
      -- Keep the event useful even after a device has been revoked. The next
      -- live checkout authorization supplies the actual revoke conflict.
      selected_device_name := 'Unknown or removed device';
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

revoke execute on function private.default_cash_offline_policy() from public, anon, authenticated, service_role;
revoke execute on function public.set_payment_method_offline_policy(uuid, uuid, text) from public, anon, service_role;
revoke execute on function public.record_offline_sync_event(uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, bigint) from public, anon, service_role;
grant execute on function public.set_payment_method_offline_policy(uuid, uuid, text) to authenticated;
grant execute on function public.record_offline_sync_event(uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, bigint) to authenticated;

comment on table public.offline_sync_events is
  'Server-observed offline POS synchronization outcomes. Browser-local pending work is intentionally never uploaded before connectivity returns.';
comment on column public.payment_methods.offline_policy is
  'disabled blocks offline settlement; cash permits one locally captured cash payment; manual_external is reserved for an explicitly configured manual workflow.';
comment on function public.record_offline_sync_event(uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, bigint) is
  'Records only a validated employee-owned offline checkout sync outcome for manager review.';

notify pgrst, 'reload schema';

commit;
