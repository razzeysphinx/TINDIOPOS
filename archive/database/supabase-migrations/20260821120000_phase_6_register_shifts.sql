-- TINDIO Phase 6: accountable register shifts and cash movements.
-- Existing sales and refunds remain intact. New transactions are assigned to an
-- open shift at the database boundary so expected cash is always derived from
-- immutable financial records rather than browser state.

begin;

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  register_id uuid not null,
  opened_by_employee_id uuid not null,
  closed_by_employee_id uuid,
  status text not null default 'open',
  opening_cash_minor bigint not null default 0,
  expected_cash_minor bigint,
  counted_cash_minor bigint,
  difference_minor bigint,
  opening_note text,
  closing_note text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shifts_id_organization_unique unique (id, organization_id),
  constraint shifts_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint shifts_register_organization_fkey
    foreign key (register_id, organization_id)
    references public.registers (id, organization_id)
    on delete restrict,
  constraint shifts_opened_by_organization_fkey
    foreign key (opened_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint shifts_closed_by_organization_fkey
    foreign key (closed_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint shifts_status_values check (status in ('open', 'closed')),
  constraint shifts_opening_cash_nonnegative check (opening_cash_minor >= 0),
  constraint shifts_counted_cash_nonnegative check (
    counted_cash_minor is null or counted_cash_minor >= 0
  ),
  constraint shifts_opening_note_length check (
    opening_note is null or char_length(opening_note) between 2 and 500
  ),
  constraint shifts_closing_note_length check (
    closing_note is null or char_length(closing_note) between 2 and 500
  ),
  constraint shifts_close_state check (
    (
      status = 'open'
      and closed_by_employee_id is null
      and expected_cash_minor is null
      and counted_cash_minor is null
      and difference_minor is null
      and closing_note is null
      and closed_at is null
    )
    or (
      status = 'closed'
      and closed_by_employee_id is not null
      and expected_cash_minor is not null
      and counted_cash_minor is not null
      and difference_minor = counted_cash_minor - expected_cash_minor
      and closed_at is not null
    )
  )
);

create index shifts_organization_status_opened_idx
  on public.shifts (organization_id, status, opened_at desc);
create index shifts_store_status_opened_idx
  on public.shifts (store_id, status, opened_at desc);
create index shifts_register_opened_idx on public.shifts (register_id, opened_at desc);
create index shifts_opened_by_opened_idx
  on public.shifts (opened_by_employee_id, opened_at desc);
create index shifts_closed_by_closed_idx
  on public.shifts (closed_by_employee_id, closed_at desc)
  where closed_by_employee_id is not null;
create unique index shifts_one_open_per_register_idx
  on public.shifts (organization_id, register_id)
  where status = 'open';
create unique index shifts_one_open_per_employee_idx
  on public.shifts (organization_id, opened_by_employee_id)
  where status = 'open';

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  shift_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  employee_id uuid not null,
  movement_type text not null,
  amount_minor bigint not null,
  reason text not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint cash_movements_shift_organization_fkey
    foreign key (shift_id, organization_id)
    references public.shifts (id, organization_id)
    on delete restrict,
  constraint cash_movements_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint cash_movements_register_organization_fkey
    foreign key (register_id, organization_id)
    references public.registers (id, organization_id)
    on delete restrict,
  constraint cash_movements_employee_organization_fkey
    foreign key (employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint cash_movements_type_values check (movement_type in ('PAY_IN', 'PAY_OUT')),
  constraint cash_movements_amount_positive check (amount_minor > 0),
  constraint cash_movements_reason_length check (char_length(reason) between 2 and 500),
  constraint cash_movements_organization_key_unique unique (organization_id, idempotency_key)
);

create index cash_movements_shift_created_idx
  on public.cash_movements (shift_id, created_at desc);
create index cash_movements_organization_register_created_idx
  on public.cash_movements (organization_id, register_id, created_at desc);
create index cash_movements_employee_created_idx
  on public.cash_movements (employee_id, created_at desc);

alter table public.sales add column shift_id uuid;
alter table public.refunds add column shift_id uuid;

alter table public.sales
  add constraint sales_shift_organization_fkey
  foreign key (shift_id, organization_id)
  references public.shifts (id, organization_id)
  on delete restrict;

alter table public.refunds
  add constraint refunds_shift_organization_fkey
  foreign key (shift_id, organization_id)
  references public.shifts (id, organization_id)
  on delete restrict;

create index sales_shift_completed_idx
  on public.sales (shift_id, completed_at desc)
  where shift_id is not null;
create index refunds_shift_completed_idx
  on public.refunds (shift_id, completed_at desc)
  where shift_id is not null;

create or replace function private.has_shift_access(
  target_organization_id uuid,
  target_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      (select private.has_permission(target_organization_id, 'settings.manage'))
      or exists (
        select 1
        from public.employees employee
        join public.employee_stores employee_store
          on employee_store.employee_id = employee.id
         and employee_store.organization_id = employee.organization_id
         and employee_store.store_id = target_store_id
        where employee.organization_id = target_organization_id
          and employee.profile_id = (select auth.uid())
          and employee.status = 'active'
          and (
            (select private.has_permission(target_organization_id, 'shifts.open'))
            or (select private.has_permission(target_organization_id, 'shifts.close'))
            or (select private.has_permission(target_organization_id, 'cash.pay_in'))
            or (select private.has_permission(target_organization_id, 'cash.pay_out'))
          )
      )
    );
$$;

revoke execute on function private.has_shift_access(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function private.calculate_shift_cash(
  target_shift_id uuid
)
returns table (
  cash_sales_minor bigint,
  cash_refunds_minor bigint,
  pay_ins_minor bigint,
  pay_outs_minor bigint,
  expected_cash_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with amounts as (
    select
      coalesce((
        select sum(payment.amount_minor)
        from public.sales sale
        join public.payments payment
          on payment.sale_id = sale.id
         and payment.organization_id = sale.organization_id
        where sale.shift_id = target_shift_id
          and payment.payment_method_type_snapshot = 'CASH'
      ), 0)::bigint as cash_sales_minor,
      coalesce((
        select sum(refund_payment.amount_minor)
        from public.refunds refund
        join public.refund_payments refund_payment
          on refund_payment.refund_id = refund.id
         and refund_payment.organization_id = refund.organization_id
        where refund.shift_id = target_shift_id
          and refund_payment.payment_method_type_snapshot = 'CASH'
      ), 0)::bigint as cash_refunds_minor,
      coalesce((
        select sum(movement.amount_minor)
        from public.cash_movements movement
        where movement.shift_id = target_shift_id
          and movement.movement_type = 'PAY_IN'
      ), 0)::bigint as pay_ins_minor,
      coalesce((
        select sum(movement.amount_minor)
        from public.cash_movements movement
        where movement.shift_id = target_shift_id
          and movement.movement_type = 'PAY_OUT'
      ), 0)::bigint as pay_outs_minor
  )
  select
    amounts.cash_sales_minor,
    amounts.cash_refunds_minor,
    amounts.pay_ins_minor,
    amounts.pay_outs_minor,
    shift.opening_cash_minor
      + amounts.cash_sales_minor
      - amounts.cash_refunds_minor
      + amounts.pay_ins_minor
      - amounts.pay_outs_minor
  from amounts
  join public.shifts shift on shift.id = target_shift_id;
$$;

revoke execute on function private.calculate_shift_cash(uuid)
from public, anon, authenticated, service_role;

create or replace function private.assign_open_shift_to_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_shift_id uuid;
begin
  select shift.id
  into active_shift_id
  from public.shifts shift
  where shift.organization_id = new.organization_id
    and shift.store_id = new.store_id
    and shift.register_id = new.register_id
    and shift.opened_by_employee_id = new.cashier_employee_id
    and shift.status = 'open'
  for update;

  if active_shift_id is null then
    raise exception 'Open a register shift before completing sales on this register.'
      using errcode = '23514';
  end if;

  new.shift_id := active_shift_id;
  return new;
end;
$$;

revoke execute on function private.assign_open_shift_to_sale()
from public, anon, authenticated, service_role;

create trigger sales_assign_open_shift
before insert on public.sales
for each row execute function private.assign_open_shift_to_sale();

create or replace function private.assign_open_shift_to_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_shift_id uuid;
begin
  select shift.id
  into active_shift_id
  from public.shifts shift
  where shift.organization_id = new.organization_id
    and shift.store_id = new.store_id
    and shift.register_id = new.register_id
    and shift.opened_by_employee_id = new.refunded_by_employee_id
    and shift.status = 'open'
  for update;

  if active_shift_id is null then
    raise exception 'Open the original register shift before processing this refund.'
      using errcode = '23514';
  end if;

  new.shift_id := active_shift_id;
  return new;
end;
$$;

revoke execute on function private.assign_open_shift_to_refund()
from public, anon, authenticated, service_role;

create trigger refunds_assign_open_shift
before insert on public.refunds
for each row execute function private.assign_open_shift_to_refund();

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
  insert into public.shifts (
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
  returning id, opened_at, false;
end;
$$;

revoke execute on function private.open_register_shift(uuid, uuid, uuid, bigint, text)
from public, anon, authenticated, service_role;

create or replace function private.close_register_shift(
  target_organization_id uuid,
  target_shift_id uuid,
  target_counted_cash_minor bigint,
  target_closing_note text
)
returns table (
  shift_id uuid,
  expected_cash_minor bigint,
  counted_cash_minor bigint,
  difference_minor bigint,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  target_shift public.shifts%rowtype;
  calculated_cash record;
  normalized_closing_note text;
begin
  if target_organization_id is null
    or target_shift_id is null
    or target_counted_cash_minor is null
    or target_counted_cash_minor < 0 then
    raise exception 'A shift and non-negative counted cash amount are required.'
      using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'shifts.close')) then
    raise exception 'Shift closing permission is required.' using errcode = '42501';
  end if;

  normalized_closing_note := nullif(trim(coalesce(target_closing_note, '')), '');
  if normalized_closing_note is not null
    and char_length(normalized_closing_note) not between 2 and 500 then
    raise exception 'A closing note must contain between 2 and 500 characters.'
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

  select *
  into calculated_cash
  from private.calculate_shift_cash(target_shift.id);

  return query
  update public.shifts shift
  set
    status = 'closed',
    closed_by_employee_id = actor_employee_id,
    expected_cash_minor = calculated_cash.expected_cash_minor,
    counted_cash_minor = target_counted_cash_minor,
    difference_minor = target_counted_cash_minor - calculated_cash.expected_cash_minor,
    closing_note = normalized_closing_note,
    closed_at = now()
  where shift.id = target_shift.id
    and shift.organization_id = target_organization_id
  returning
    shift.id,
    shift.expected_cash_minor,
    shift.counted_cash_minor,
    shift.difference_minor,
    shift.closed_at;
end;
$$;

revoke execute on function private.close_register_shift(uuid, uuid, bigint, text)
from public, anon, authenticated, service_role;

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
  insert into public.cash_movements (
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
  returning id, created_at, false;
end;
$$;

revoke execute on function private.record_cash_movement(uuid, uuid, text, bigint, text, uuid)
from public, anon, authenticated, service_role;

create or replace function private.get_shift_cash_summary(
  target_organization_id uuid,
  target_shift_id uuid
)
returns table (
  shift_id uuid,
  status text,
  opening_cash_minor bigint,
  cash_sales_minor bigint,
  cash_refunds_minor bigint,
  pay_ins_minor bigint,
  pay_outs_minor bigint,
  expected_cash_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_shift public.shifts%rowtype;
  calculated_cash record;
begin
  select shift.*
  into target_shift
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id;

  if target_shift.id is null then
    raise exception 'The shift was not found.' using errcode = 'P0002';
  end if;

  if not (select private.has_shift_access(target_organization_id, target_shift.store_id)) then
    raise exception 'Shift access is required.' using errcode = '42501';
  end if;

  select *
  into calculated_cash
  from private.calculate_shift_cash(target_shift.id);

  return query
  select
    target_shift.id,
    target_shift.status,
    target_shift.opening_cash_minor,
    calculated_cash.cash_sales_minor,
    calculated_cash.cash_refunds_minor,
    calculated_cash.pay_ins_minor,
    calculated_cash.pay_outs_minor,
    calculated_cash.expected_cash_minor;
end;
$$;

revoke execute on function private.get_shift_cash_summary(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.open_register_shift(
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
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.open_register_shift(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_opening_cash_minor,
    target_opening_note
  );
$$;

create or replace function public.close_register_shift(
  target_organization_id uuid,
  target_shift_id uuid,
  target_counted_cash_minor bigint,
  target_closing_note text
)
returns table (
  shift_id uuid,
  expected_cash_minor bigint,
  counted_cash_minor bigint,
  difference_minor bigint,
  closed_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.close_register_shift(
    target_organization_id,
    target_shift_id,
    target_counted_cash_minor,
    target_closing_note
  );
$$;

create or replace function public.record_cash_movement(
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
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.record_cash_movement(
    target_organization_id,
    target_shift_id,
    target_movement_type,
    target_amount_minor,
    target_reason,
    target_idempotency_key
  );
$$;

create or replace function public.get_shift_cash_summary(
  target_organization_id uuid,
  target_shift_id uuid
)
returns table (
  shift_id uuid,
  status text,
  opening_cash_minor bigint,
  cash_sales_minor bigint,
  cash_refunds_minor bigint,
  pay_ins_minor bigint,
  pay_outs_minor bigint,
  expected_cash_minor bigint
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.get_shift_cash_summary(target_organization_id, target_shift_id);
$$;

revoke execute on function public.open_register_shift(uuid, uuid, uuid, bigint, text)
from public, anon, service_role;
revoke execute on function public.close_register_shift(uuid, uuid, bigint, text)
from public, anon, service_role;
revoke execute on function public.record_cash_movement(uuid, uuid, text, bigint, text, uuid)
from public, anon, service_role;
revoke execute on function public.get_shift_cash_summary(uuid, uuid)
from public, anon, service_role;

grant select on public.shifts, public.cash_movements to authenticated;

grant execute on function private.has_shift_access(uuid, uuid) to authenticated;
grant execute on function private.open_register_shift(uuid, uuid, uuid, bigint, text) to authenticated;
grant execute on function private.close_register_shift(uuid, uuid, bigint, text) to authenticated;
grant execute on function private.record_cash_movement(uuid, uuid, text, bigint, text, uuid) to authenticated;
grant execute on function private.get_shift_cash_summary(uuid, uuid) to authenticated;

grant execute on function public.open_register_shift(uuid, uuid, uuid, bigint, text) to authenticated;
grant execute on function public.close_register_shift(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.record_cash_movement(uuid, uuid, text, bigint, text, uuid) to authenticated;
grant execute on function public.get_shift_cash_summary(uuid, uuid) to authenticated;

alter table public.shifts enable row level security;
alter table public.cash_movements enable row level security;

revoke all on public.shifts, public.cash_movements
from public, anon, authenticated, service_role;

grant select on public.shifts, public.cash_movements to authenticated;

create policy shifts_select_authorized
on public.shifts
for select
to authenticated
using ((select private.has_shift_access(organization_id, store_id)));

create policy cash_movements_select_authorized
on public.cash_movements
for select
to authenticated
using ((select private.has_shift_access(organization_id, store_id)));

comment on table public.shifts
is 'Immutable register-shift lifecycle: opening cash, server-derived expected cash, drawer count, and recorded difference.';
comment on table public.cash_movements
is 'Append-only pay-in and pay-out ledger entries for an open register shift.';
comment on column public.sales.shift_id
is 'The open register shift assigned atomically when the sale is created; historical pre-Phase-6 sales remain null.';
comment on column public.refunds.shift_id
is 'The open register shift assigned atomically when the refund is created; historical pre-Phase-6 refunds remain null.';
comment on function public.open_register_shift(uuid, uuid, uuid, bigint, text)
is 'Opens one assigned active employee shift per active register, with non-negative opening cash.';
comment on function public.close_register_shift(uuid, uuid, bigint, text)
is 'Locks and closes an open shift using cash sales, cash refunds, pay-ins, and pay-outs to derive expected cash.';
comment on function public.record_cash_movement(uuid, uuid, text, bigint, text, uuid)
is 'Records one idempotent, authorized pay-in or pay-out against an open shift.';
comment on function public.get_shift_cash_summary(uuid, uuid)
is 'Returns a permission-checked, server-derived cash expectation for a shift.';

commit;
