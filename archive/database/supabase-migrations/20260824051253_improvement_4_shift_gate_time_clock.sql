-- TINDIO Improvement Phase 4: shift-first POS enforcement, configurable
-- blind cash closing, and a time clock that is intentionally independent of
-- register-shift status.

begin;

alter table public.organizations
  add column if not exists show_expected_cash_before_close boolean not null default true;

-- This boolean is deliberately narrow: it answers whether the signed-in
-- employee currently owns an open shift on this exact drawer. It is safe for
-- RLS because it returns no financial values and does not expose private rows.
create or replace function private.has_active_pos_shift_access(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.has_permission(target_organization_id, 'sales.create'))
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
       and employee_store.store_id = target_store_id
      join public.stores store
        on store.id = employee_store.store_id
       and store.organization_id = employee_store.organization_id
       and store.is_active
      join public.registers register
        on register.id = target_register_id
       and register.organization_id = employee.organization_id
       and register.store_id = target_store_id
       and register.is_active
      join public.shifts shift
        on shift.organization_id = employee.organization_id
       and shift.store_id = target_store_id
       and shift.register_id = target_register_id
       and shift.opened_by_employee_id = employee.id
       and shift.status = 'open'
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
    );
$$;

create or replace function private.require_active_pos_shift(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  active_shift_id uuid;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null then
    raise exception 'A store and register are required for POS activity.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.stores store
    on store.id = employee_store.store_id
   and store.organization_id = employee_store.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.organization_id = employee.organization_id
   and register.store_id = target_store_id
   and register.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  for key share of employee, store, register;

  if actor_employee_id is null then
    raise exception 'An active employee assignment, store, and register are required.'
      using errcode = '42501';
  end if;

  select shift.id
  into active_shift_id
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.store_id = target_store_id
    and shift.register_id = target_register_id
    and shift.opened_by_employee_id = actor_employee_id
    and shift.status = 'open'
  for update;

  if active_shift_id is null then
    raise exception 'Open your register shift before using transactional POS features.'
      using errcode = '42501';
  end if;

  return actor_employee_id;
end;
$$;

revoke execute on function private.has_active_pos_shift_access(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.require_active_pos_shift(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

-- The original shift functions already verify authentication and role
-- permissions. These two targeted updates add the missing drawer ownership
-- check without changing their established idempotency or approval behavior.
do $$
declare
  function_definition text;
  target_procedure regprocedure :=
    'private.close_register_shift(uuid,uuid,bigint,text)'::regprocedure;
  old_fragment text := $old$
  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.'
      using errcode = '42501';
  end if;

  select *
$old$;
  new_fragment text := $new$
  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.'
      using errcode = '42501';
  end if;

  if target_shift.opened_by_employee_id is distinct from actor_employee_id then
    raise exception 'Only the employee who opened this shift can close it.'
      using errcode = '42501';
  end if;

  select *
$new$;
begin
  select pg_get_functiondef(target_procedure) into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Unexpected close_register_shift definition; aborting ownership hardening.';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$$;

do $$
declare
  function_definition text;
  target_procedure regprocedure :=
    'private.record_cash_movement(uuid,uuid,text,bigint,text,uuid)'::regprocedure;
  old_fragment text := $old$
  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.'
      using errcode = '42501';
  end if;

  select movement.*
$old$;
  new_fragment text := $new$
  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.'
      using errcode = '42501';
  end if;

  if target_shift.opened_by_employee_id is distinct from actor_employee_id then
    raise exception 'Only the employee who opened this shift can record cash movements.'
      using errcode = '42501';
  end if;

  select movement.*
$new$;
begin
  select pg_get_functiondef(target_procedure) into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Unexpected record_cash_movement definition; aborting ownership hardening.';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$$;

-- A replayed checkout remains readable after the drawer has closed, but a new
-- checkout request must pass the owned open-shift check before it writes any
-- sale request or financial record.
do $$
declare
  function_definition text;
  target_procedure regprocedure :=
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure;
  old_fragment text := $old$
  insert into public.advanced_checkout_requests (organization_id, actor_employee_id, idempotency_key, request_payload) values (target_organization_id, actor_employee_id, target_idempotency_key, request_payload);
$old$;
  new_fragment text := $new$
  perform private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  insert into public.advanced_checkout_requests (organization_id, actor_employee_id, idempotency_key, request_payload) values (target_organization_id, actor_employee_id, target_idempotency_key, request_payload);
$new$;
begin
  select pg_get_functiondef(target_procedure) into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Unexpected checkout_advanced_sale definition; aborting shift-gate hardening.';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$$;

-- Held tickets are transactional POS work too. The gate now applies both to
-- a new ticket and to an update or cancellation of an existing ticket.
do $$
declare
  function_definition text;
  target_procedure regprocedure :=
    'private.save_open_ticket(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure;
  old_fragment text := $old$
  perform private.validate_advanced_cart(target_organization_id, target_store_id, target_cart);
$old$;
  new_fragment text := $new$
  actor_employee_id := private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  perform private.validate_advanced_cart(target_organization_id, target_store_id, target_cart);
$new$;
begin
  select pg_get_functiondef(target_procedure) into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Unexpected save_open_ticket definition; aborting shift-gate hardening.';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$$;

create or replace function private.cancel_open_ticket(
  target_organization_id uuid,
  target_ticket_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_ticket public.open_tickets%rowtype;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select ticket.*
  into target_ticket
  from public.open_tickets ticket
  where ticket.id = target_ticket_id
    and ticket.organization_id = target_organization_id
    and ticket.status = 'open'
  for update;

  if target_ticket.id is null then
    raise exception 'This open ticket is no longer available.' using errcode = 'P0002';
  end if;

  perform private.require_active_pos_shift(
    target_organization_id,
    target_ticket.store_id,
    target_ticket.register_id
  );

  update public.open_tickets ticket
  set status = 'cancelled'
  where ticket.id = target_ticket.id
    and ticket.organization_id = target_organization_id;
end;
$$;

-- Customer lookup and modifier selection cannot become a back door around a
-- closed POS. The customer routine keeps its stable public signature while it
-- delegates the new requirement to the established workspace helper.
do $$
declare
  function_definition text;
  target_procedure regprocedure :=
    'public.search_pos_customers(uuid,uuid,text,integer)'::regprocedure;
  old_fragment text := $old$
  return query
  select
    customer.id,
$old$;
  new_fragment text := $new$
  perform private.require_pos_workspace_access(
    target_organization_id,
    target_store_id
  );

  return query
  select
    customer.id,
$new$;
begin
  select pg_get_functiondef(target_procedure) into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Unexpected search_pos_customers definition; aborting shift-gate hardening.';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$$;

create function public.get_pos_product_modifiers(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid
)
returns table (
  group_id uuid,
  group_name text,
  min_selections smallint,
  max_selections smallint,
  options jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_workspace_access(
    target_organization_id,
    target_store_id
  );

  if not exists (
    select 1
    from public.products product
    join public.product_store_settings setting
      on setting.organization_id = product.organization_id
     and setting.product_id = product.id
     and setting.store_id = target_store_id
     and setting.is_available
    where product.organization_id = target_organization_id
      and product.id = target_product_id
      and product.status = 'active'
  ) then
    raise exception 'The selected product is not saleable at this store.' using errcode = 'P0002';
  end if;

  return query
  select
    modifier_group.id,
    modifier_group.name,
    modifier_group.min_selections,
    modifier_group.max_selections,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', modifier_option.id,
          'name', modifier_option.name,
          'price_minor', modifier_option.price_adjustment_minor
        ) order by modifier_option.sort_order, lower(modifier_option.name)
      ) filter (where modifier_option.id is not null),
      '[]'::jsonb
    )
  from public.product_modifier_groups assignment
  join public.modifier_groups modifier_group
    on modifier_group.id = assignment.modifier_group_id
   and modifier_group.organization_id = assignment.organization_id
   and modifier_group.is_active
  left join public.modifier_options modifier_option
    on modifier_option.modifier_group_id = modifier_group.id
   and modifier_option.organization_id = modifier_group.organization_id
   and modifier_option.is_active
  where assignment.organization_id = target_organization_id
    and assignment.product_id = target_product_id
  group by
    modifier_group.id,
    modifier_group.name,
    modifier_group.min_selections,
    modifier_group.max_selections,
    assignment.sort_order
  order by assignment.sort_order, lower(modifier_group.name);
end;
$$;

revoke execute on function public.get_pos_product_modifiers(uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.get_pos_product_modifiers(uuid, uuid, uuid)
from public, anon, service_role;
grant execute on function public.get_pos_product_modifiers(uuid, uuid, uuid)
to authenticated;

drop policy if exists open_tickets_select_sales_authorized on public.open_tickets;
create policy open_tickets_select_active_shift_owner
on public.open_tickets
for select
to authenticated
using (
  (select private.has_active_pos_shift_access(
    organization_id,
    store_id,
    register_id
  ))
);

-- A blind close must not leak its value through the summary RPC. Once closed,
-- the immutable snapshots are available as normal for reconciliation.
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
  show_expected_cash boolean := true;
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

  select organization.show_expected_cash_before_close
  into show_expected_cash
  from public.organizations organization
  where organization.id = target_organization_id;

  if target_shift.status = 'open' and not coalesce(show_expected_cash, true) then
    return query
    select
      target_shift.id,
      target_shift.status,
      null::bigint,
      null::bigint,
      null::bigint,
      null::bigint,
      null::bigint,
      null::bigint;
    return;
  end if;

  select *
  into calculated_cash
  from private.calculate_shift_cash(target_shift.id);

  return query
  select
    target_shift.id,
    target_shift.status,
    calculated_cash.opening_cash_minor,
    calculated_cash.cash_sales_minor,
    calculated_cash.cash_refunds_minor,
    calculated_cash.pay_ins_minor,
    calculated_cash.pay_outs_minor,
    calculated_cash.expected_cash_minor;
end;
$$;

create or replace function private.update_shift_cash_close_setting(
  target_organization_id uuid,
  target_show_expected_cash_before_close boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_organization_id is null or target_show_expected_cash_before_close is null then
    raise exception 'Choose a cash-close visibility setting.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required.' using errcode = '42501';
  end if;

  update public.organizations organization
  set show_expected_cash_before_close = target_show_expected_cash_before_close
  where organization.id = target_organization_id;

  if not found then
    raise exception 'The organization was not found.' using errcode = 'P0002';
  end if;

  return target_show_expected_cash_before_close;
end;
$$;

create or replace function public.update_shift_cash_close_setting(
  target_organization_id uuid,
  target_show_expected_cash_before_close boolean
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.update_shift_cash_close_setting(
    target_organization_id,
    target_show_expected_cash_before_close
  );
$$;

revoke execute on function private.update_shift_cash_close_setting(uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function private.update_shift_cash_close_setting(uuid, boolean)
to authenticated;
revoke execute on function public.update_shift_cash_close_setting(uuid, boolean)
from public, anon, service_role;
grant execute on function public.update_shift_cash_close_setting(uuid, boolean)
to authenticated;

-- Time clock entries are a self-service attendance record. They deliberately
-- have no foreign key to shifts and do not require opening a POS drawer.
create table public.time_clock_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  employee_id uuid not null,
  store_id uuid not null,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  clock_in_note text,
  clock_out_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_clock_entries_id_organization_unique unique (id, organization_id),
  constraint time_clock_entries_employee_organization_fkey
    foreign key (employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint time_clock_entries_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint time_clock_entries_clock_in_note_length check (
    clock_in_note is null or char_length(clock_in_note) between 2 and 500
  ),
  constraint time_clock_entries_clock_out_note_length check (
    clock_out_note is null or char_length(clock_out_note) between 2 and 500
  ),
  constraint time_clock_entries_ordering check (
    clocked_out_at is null or clocked_out_at >= clocked_in_at
  )
);

create unique index time_clock_entries_one_open_employee_idx
  on public.time_clock_entries (organization_id, employee_id)
  where clocked_out_at is null;
create index time_clock_entries_employee_started_idx
  on public.time_clock_entries (organization_id, employee_id, clocked_in_at desc);
create index time_clock_entries_store_started_idx
  on public.time_clock_entries (organization_id, store_id, clocked_in_at desc);

create trigger time_clock_entries_set_updated_at
before update on public.time_clock_entries
for each row execute function private.set_updated_at();

alter table public.time_clock_entries enable row level security;
revoke all on table public.time_clock_entries from public, anon, authenticated, service_role;
grant select on table public.time_clock_entries to authenticated;

create policy time_clock_entries_select_self_or_settings_manager
on public.time_clock_entries
for select
to authenticated
using (
  employee_id = (select private.current_employee_id(organization_id))
  or (select private.has_permission(organization_id, 'settings.manage'))
);

create or replace function private.clock_in_employee(
  target_organization_id uuid,
  target_store_id uuid,
  target_clock_in_note text default null
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  existing_entry public.time_clock_entries%rowtype;
  normalized_note text := nullif(trim(coalesce(target_clock_in_note, '')), '');
begin
  if target_organization_id is null or target_store_id is null then
    raise exception 'Choose an assigned store before clocking in.' using errcode = '23514';
  end if;

  if normalized_note is not null and char_length(normalized_note) not between 2 and 500 then
    raise exception 'A clock-in note must contain between 2 and 500 characters.' using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.stores store
    on store.id = employee_store.store_id
   and store.organization_id = employee_store.organization_id
   and store.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  for key share of employee, store;

  if actor_employee_id is null then
    raise exception 'An active employee assignment for this store is required.' using errcode = '42501';
  end if;

  select entry.*
  into existing_entry
  from public.time_clock_entries entry
  where entry.organization_id = target_organization_id
    and entry.employee_id = actor_employee_id
    and entry.clocked_out_at is null
  for update;

  if existing_entry.id is not null then
    if existing_entry.store_id = target_store_id then
      return query
      select
        existing_entry.id,
        existing_entry.store_id,
        existing_entry.clocked_in_at,
        existing_entry.clocked_out_at,
        true;
      return;
    end if;

    raise exception 'Clock out from your current store before clocking in elsewhere.'
      using errcode = '23505';
  end if;

  return query
  insert into public.time_clock_entries as entry (
    organization_id,
    employee_id,
    store_id,
    clock_in_note
  )
  values (
    target_organization_id,
    actor_employee_id,
    target_store_id,
    normalized_note
  )
  returning entry.id, entry.store_id, entry.clocked_in_at, entry.clocked_out_at, false;
end;
$$;

create or replace function private.clock_out_employee(
  target_organization_id uuid,
  target_clock_out_note text default null
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_note text := nullif(trim(coalesce(target_clock_out_note, '')), '');
begin
  if target_organization_id is null then
    raise exception 'An organization is required to clock out.' using errcode = '23514';
  end if;

  if normalized_note is not null and char_length(normalized_note) not between 2 and 500 then
    raise exception 'A clock-out note must contain between 2 and 500 characters.' using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  for key share;

  if actor_employee_id is null then
    raise exception 'An active employee is required to clock out.' using errcode = '42501';
  end if;

  return query
  update public.time_clock_entries entry
  set
    clocked_out_at = now(),
    clock_out_note = normalized_note
  where entry.organization_id = target_organization_id
    and entry.employee_id = actor_employee_id
    and entry.clocked_out_at is null
  returning entry.id, entry.store_id, entry.clocked_in_at, entry.clocked_out_at;

  if not found then
    raise exception 'There is no open time-clock entry to close.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function private.get_current_time_clock_entry(
  target_organization_id uuid
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  if target_organization_id is null then
    raise exception 'An organization is required for the time clock.' using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee is required for the time clock.' using errcode = '42501';
  end if;

  return query
  select entry.id, entry.store_id, entry.clocked_in_at
  from public.time_clock_entries entry
  where entry.organization_id = target_organization_id
    and entry.employee_id = actor_employee_id
    and entry.clocked_out_at is null;
end;
$$;

create or replace function public.clock_in_employee(
  target_organization_id uuid,
  target_store_id uuid,
  target_clock_in_note text default null
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  was_replayed boolean
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.clock_in_employee(
    target_organization_id,
    target_store_id,
    target_clock_in_note
  );
$$;

create or replace function public.clock_out_employee(
  target_organization_id uuid,
  target_clock_out_note text default null
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.clock_out_employee(
    target_organization_id,
    target_clock_out_note
  );
$$;

create or replace function public.get_current_time_clock_entry(
  target_organization_id uuid
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_current_time_clock_entry(target_organization_id);
$$;

revoke execute on function private.clock_in_employee(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke execute on function private.clock_out_employee(uuid, text)
from public, anon, authenticated, service_role;
revoke execute on function private.get_current_time_clock_entry(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.clock_in_employee(uuid, uuid, text) to authenticated;
grant execute on function private.clock_out_employee(uuid, text) to authenticated;
grant execute on function private.get_current_time_clock_entry(uuid) to authenticated;

revoke execute on function public.clock_in_employee(uuid, uuid, text)
from public, anon, service_role;
revoke execute on function public.clock_out_employee(uuid, text)
from public, anon, service_role;
revoke execute on function public.get_current_time_clock_entry(uuid)
from public, anon, service_role;
grant execute on function public.clock_in_employee(uuid, uuid, text) to authenticated;
grant execute on function public.clock_out_employee(uuid, text) to authenticated;
grant execute on function public.get_current_time_clock_entry(uuid) to authenticated;

comment on column public.organizations.show_expected_cash_before_close
is 'When false, active shift cash expectations are withheld until the counted close is submitted.';
comment on table public.time_clock_entries
is 'Self-service employee attendance entries. Clock status is independent from POS register-shift status.';
comment on function public.update_shift_cash_close_setting(uuid, boolean)
is 'Changes whether active-shift expected cash is visible before cash counting begins.';
comment on function public.clock_in_employee(uuid, uuid, text)
is 'Starts one self-service time-clock entry at an assigned active store; it does not open a register shift.';
comment on function public.clock_out_employee(uuid, text)
is 'Closes the caller’s current time-clock entry; it does not close a register shift.';
comment on function public.get_current_time_clock_entry(uuid)
is 'Returns the caller’s active attendance entry, if any.';

notify pgrst, 'reload schema';

commit;
