-- Correct the Phase 6 cash-movement routine output reference without changing its ledger rules.

begin;

create or replace function private.record_cash_movement(
  target_organization_id uuid,
  target_shift_id uuid,
  target_movement_type text,
  target_amount_minor bigint,
  target_reason text,
  target_idempotency_key uuid
)
returns table (
  cash_movement_id uuid,
  created_at timestamptz,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  target_shift public.shifts%rowtype;
  existing_movement public.cash_movements%rowtype;
  normalized_reason text;
  required_permission text;
begin
  if target_organization_id is null
    or target_shift_id is null
    or target_idempotency_key is null
    or target_amount_minor is null
    or target_amount_minor <= 0 then
    raise exception 'An open shift, positive amount, and cash movement key are required.'
      using errcode = '23514';
  end if;

  if target_movement_type is null
    or target_movement_type not in ('PAY_IN', 'PAY_OUT') then
    raise exception 'Select either a cash pay-in or pay-out.' using errcode = '23514';
  end if;

  required_permission := case target_movement_type
    when 'PAY_IN' then 'cash.pay_in'
    else 'cash.pay_out'
  end;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, required_permission)) then
    raise exception 'Cash movement permission is required.' using errcode = '42501';
  end if;

  normalized_reason := trim(coalesce(target_reason, ''));
  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'A cash movement reason must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select shift.*
  into target_shift
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id
    and shift.status = 'open'
  for update;

  if target_shift.id is null then
    raise exception 'The open shift was not found.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_shift.store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.'
      using errcode = '42501';
  end if;

  select movement.*
  into existing_movement
  from public.cash_movements movement
  where movement.organization_id = target_organization_id
    and movement.idempotency_key = target_idempotency_key
  for update;

  if existing_movement.id is not null then
    if existing_movement.shift_id is distinct from target_shift_id
      or existing_movement.employee_id is distinct from actor_employee_id
      or existing_movement.movement_type is distinct from target_movement_type
      or existing_movement.amount_minor is distinct from target_amount_minor
      or existing_movement.reason is distinct from normalized_reason then
      raise exception 'This cash movement key was already used for a different request.'
        using errcode = '23505';
    end if;

    return query select existing_movement.id, existing_movement.created_at, true;
    return;
  end if;

  return query
  insert into public.cash_movements as inserted_movement (
    organization_id,
    shift_id,
    store_id,
    register_id,
    employee_id,
    movement_type,
    amount_minor,
    reason,
    idempotency_key
  )
  values (
    target_organization_id,
    target_shift.id,
    target_shift.store_id,
    target_shift.register_id,
    actor_employee_id,
    target_movement_type,
    target_amount_minor,
    normalized_reason,
    target_idempotency_key
  )
  returning inserted_movement.id, inserted_movement.created_at, false;
end;
$$;

revoke execute on function private.record_cash_movement(uuid, uuid, text, bigint, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function private.record_cash_movement(uuid, uuid, text, bigint, text, uuid) to authenticated;

commit;
