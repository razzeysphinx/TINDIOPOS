-- Correct the Phase 6 routine output reference without rewriting applied history.

begin;

create or replace function private.open_register_shift(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_opening_cash_minor bigint,
  target_opening_note text
)
returns table (
  shift_id uuid,
  opened_at timestamptz,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  existing_shift public.shifts%rowtype;
  normalized_opening_note text;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_opening_cash_minor is null
    or target_opening_cash_minor < 0 then
    raise exception 'A store, register, and non-negative opening cash amount are required.'
      using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'shifts.open')) then
    raise exception 'Shift opening permission is required.' using errcode = '42501';
  end if;

  normalized_opening_note := nullif(trim(coalesce(target_opening_note, '')), '');
  if normalized_opening_note is not null
    and char_length(normalized_opening_note) not between 2 and 500 then
    raise exception 'An opening note must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  for update of employee;

  if actor_employee_id is null then
    raise exception 'An active employee assignment for this store is required.'
      using errcode = '42501';
  end if;

  perform 1
  from public.registers register
  join public.stores store
    on store.id = register.store_id
   and store.organization_id = register.organization_id
  where register.id = target_register_id
    and register.organization_id = target_organization_id
    and register.store_id = target_store_id
    and register.is_active
    and store.is_active
  for update of register;

  if not found then
    raise exception 'Select an active register belonging to this store.' using errcode = '23514';
  end if;

  select shift.*
  into existing_shift
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.register_id = target_register_id
    and shift.status = 'open'
  for update;

  if existing_shift.id is not null then
    if existing_shift.opened_by_employee_id = actor_employee_id
      and existing_shift.opening_cash_minor = target_opening_cash_minor
      and existing_shift.opening_note is not distinct from normalized_opening_note then
      return query select existing_shift.id, existing_shift.opened_at, true;
      return;
    end if;

    raise exception 'This register already has an open shift.' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.opened_by_employee_id = actor_employee_id
      and shift.status = 'open'
  ) then
    raise exception 'Close your existing register shift before opening another one.'
      using errcode = '23505';
  end if;

  return query
  insert into public.shifts as inserted_shift (
    organization_id,
    store_id,
    register_id,
    opened_by_employee_id,
    opening_cash_minor,
    opening_note
  )
  values (
    target_organization_id,
    target_store_id,
    target_register_id,
    actor_employee_id,
    target_opening_cash_minor,
    normalized_opening_note
  )
  returning inserted_shift.id, inserted_shift.opened_at, false;
end;
$$;

revoke execute on function private.open_register_shift(uuid, uuid, uuid, bigint, text)
from public, anon, authenticated, service_role;
grant execute on function private.open_register_shift(uuid, uuid, uuid, bigint, text) to authenticated;

commit;
