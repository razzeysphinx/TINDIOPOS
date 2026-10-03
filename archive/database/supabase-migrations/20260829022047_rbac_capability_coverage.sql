-- Align the already-defined POS capabilities with every entry point. Runtime
-- authorization remains permission based; role codes below are used only to
-- maintain the predefined Cashier permission bundle.
begin;

create or replace function private.require_pos_capabilities(
  target_organization_id uuid,
  required_permission_codes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing_permission_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'An authenticated employee is required.' using errcode = '42501';
  end if;

  select required.permission_code
  into missing_permission_code
  from unnest(coalesce(required_permission_codes, '{}'::text[])) as required(permission_code)
  where not (select private.has_permission(target_organization_id, required.permission_code))
  order by required.permission_code
  limit 1;

  if missing_permission_code is not null then
    raise exception 'The % permission is required.', missing_permission_code using errcode = '42501';
  end if;
end;
$$;

-- The outer public RPC is the Data API entry point. Check every capability
-- here before it delegates to the existing reviewed checkout routine.
create or replace function public.checkout_advanced_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb,
  target_customer_id uuid,
  target_loyalty_redemption_points integer,
  target_discount_id uuid,
  target_tax_rate_id uuid,
  target_dining_option_id uuid,
  target_open_ticket_id uuid
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  change_minor bigint,
  payment_summary jsonb,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_capabilities(
    target_organization_id,
    array['pos.access', 'sales.create', 'payments.accept']
  );

  if target_discount_id is not null then
    perform private.require_pos_capabilities(
      target_organization_id,
      array['discounts.apply']
    );
  end if;

  if target_open_ticket_id is not null then
    perform private.require_pos_capabilities(
      target_organization_id,
      array['tickets.manage']
    );
  end if;

  return query
  select *
  from private.checkout_advanced_sale(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments,
    target_customer_id,
    target_loyalty_redemption_points,
    target_discount_id,
    target_tax_rate_id,
    target_dining_option_id,
    target_open_ticket_id
  );
end;
$$;

-- A blind count stays blind for the cashier, while an explicitly authorized
-- supervisor can inspect expected cash during an open shift. Closed shifts
-- retain their immutable reconciliation figures for audit.
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

  if target_shift.status = 'open'
    and not coalesce(show_expected_cash, true)
    and not (select private.has_permission(target_organization_id, 'shifts.view_expected_cash')) then
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

create or replace function public.get_pos_shift_operational_summary(
  target_organization_id uuid,
  target_shift_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  shift_record public.shifts%rowtype;
  cash_record record;
  opened_by_name text;
  store_name text;
  register_name text;
  show_expected_before_close boolean := true;
  gross_sales_minor bigint := 0;
  refunds_minor bigint := 0;
  discounts_minor bigint := 0;
  expected_cash_minor bigint := 0;
begin
  if target_organization_id is null or target_shift_id is null then
    raise exception 'The POS shift summary request is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null then
    raise exception 'Sign in is required to view a shift summary.' using errcode = '42501';
  end if;

  select shift.*
  into shift_record
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id;

  if shift_record.id is null then
    raise exception 'The shift was not found.' using errcode = 'P0002';
  end if;

  if not (select private.has_shift_access(target_organization_id, shift_record.store_id)) then
    raise exception 'Shift access is required.' using errcode = '42501';
  end if;

  select coalesce(profile.full_name, profile.email, 'Employee')
  into opened_by_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = shift_record.opened_by_employee_id
    and employee.organization_id = target_organization_id;

  select store.name into store_name
  from public.stores store
  where store.id = shift_record.store_id
    and store.organization_id = target_organization_id;

  select register.name into register_name
  from public.registers register
  where register.id = shift_record.register_id
    and register.organization_id = target_organization_id;

  select * into cash_record from private.calculate_shift_cash(shift_record.id);
  select organization.show_expected_cash_before_close
  into show_expected_before_close
  from public.organizations organization
  where organization.id = target_organization_id;

  select
    coalesce(sum(sale.subtotal_minor), 0)::bigint,
    coalesce(sum(sale.discount_minor), 0)::bigint
  into gross_sales_minor, discounts_minor
  from public.sales sale
  where sale.organization_id = target_organization_id
    and sale.shift_id = shift_record.id;

  select coalesce(sum(refund.total_minor), 0)::bigint
  into refunds_minor
  from public.refunds refund
  where refund.organization_id = target_organization_id
    and refund.shift_id = shift_record.id;

  expected_cash_minor := case
    when shift_record.status = 'open'
      and not coalesce(show_expected_before_close, true)
      and not (select private.has_permission(target_organization_id, 'shifts.view_expected_cash'))
      then null
    else cash_record.expected_cash_minor
  end;

  return jsonb_build_object(
    'shift', jsonb_build_object(
      'id', shift_record.id,
      'number', 'SHIFT-' || upper(left(shift_record.id::text, 8)),
      'status', shift_record.status,
      'openedBy', coalesce(opened_by_name, 'Employee'),
      'openedAt', shift_record.opened_at,
      'closedAt', shift_record.closed_at,
      'store', coalesce(store_name, 'Store'),
      'register', coalesce(register_name, 'Register'),
      'startingCashMinor', shift_record.opening_cash_minor,
      'actualCashMinor', shift_record.counted_cash_minor,
      'differenceMinor', shift_record.difference_minor
    ),
    'cash', jsonb_build_object(
      'cashPaymentsMinor', cash_record.cash_sales_minor,
      'cashRefundsMinor', cash_record.cash_refunds_minor,
      'paidInMinor', cash_record.pay_ins_minor,
      'paidOutMinor', cash_record.pay_outs_minor,
      'expectedCashMinor', expected_cash_minor
    ),
    'sales', jsonb_build_object(
      'grossSalesMinor', gross_sales_minor,
      'refundsMinor', refunds_minor,
      'discountsMinor', discounts_minor,
      'netSalesMinor', gross_sales_minor - refunds_minor - discounts_minor
    )
  );
end;
$$;

-- Existing ticket procedures are SECURITY DEFINER and mutate open_tickets.
-- The trigger protects all of them, including direct RPC calls, without
-- duplicating their established shift, store, and audit logic.
create or replace function private.enforce_open_ticket_capabilities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  if tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
  else
    target_organization_id := new.organization_id;
  end if;

  -- Internal database maintenance has no Supabase user context. Every client
  -- request has auth.uid() and must satisfy the full POS ticket capability.
  if (select auth.uid()) is not null then
    perform private.require_pos_capabilities(
      target_organization_id,
      array['pos.access', 'sales.create', 'tickets.manage']
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_open_ticket_capabilities on public.open_tickets;
create trigger enforce_open_ticket_capabilities
before insert or update or delete on public.open_tickets
for each row execute function private.enforce_open_ticket_capabilities();

-- Ticket reads are also a capability, so a direct Data API RPC cannot reveal
-- open ticket/customer details to an employee without tickets.manage.
create or replace function public.get_pos_open_tickets(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns table (
  ticket_id uuid,
  label text,
  note text,
  cart jsonb,
  customer_id uuid,
  customer_number bigint,
  loyalty_card_code text,
  customer_full_name text,
  customer_phone text,
  customer_email text,
  customer_loyalty_points integer,
  dining_option_id uuid,
  assigned_employee_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_capabilities(
    target_organization_id,
    array['pos.access', 'sales.create', 'tickets.manage']
  );
  perform private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  return query
  select
    ticket.id,
    ticket.label,
    ticket.note,
    ticket.cart,
    customer.id,
    customer.customer_number,
    customer.loyalty_card_code,
    customer.full_name,
    customer.phone,
    customer.email,
    coalesce((
      select sum(transaction.points_delta)::integer
      from public.loyalty_transactions transaction
      where transaction.organization_id = ticket.organization_id
        and transaction.customer_id = customer.id
    ), 0)::integer,
    ticket.dining_option_id,
    ticket.assigned_employee_id,
    ticket.updated_at
  from public.open_tickets ticket
  left join public.customers customer
    on customer.id = ticket.customer_id
   and customer.organization_id = ticket.organization_id
  where ticket.organization_id = target_organization_id
    and ticket.store_id = target_store_id
    and ticket.register_id = target_register_id
    and ticket.status = 'open'
  order by ticket.updated_at desc, ticket.id;
end;
$$;

revoke all on function private.require_pos_capabilities(uuid, text[]),
  private.enforce_open_ticket_capabilities()
from public, anon, authenticated, service_role;
revoke execute on function public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid),
  public.get_pos_open_tickets(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.checkout_advanced_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid),
  public.get_pos_open_tickets(uuid, uuid, uuid)
to authenticated;

-- Cashier is a predefined bundle, not a special runtime exception. Open
-- tickets are part of its intended operational POS workflow, so synchronize
-- existing organizations and any future system Cashier role.
insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, 'tickets.manage'
from public.roles role
where role.is_system
  and role.code = 'cashier'
on conflict do nothing;

create or replace function private.grant_cashier_ticket_capability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_system and new.code = 'cashier' then
    insert into public.role_permissions (organization_id, role_id, permission_code)
    values (new.organization_id, new.id, 'tickets.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists grant_cashier_ticket_capability on public.roles;
create trigger grant_cashier_ticket_capability
after insert on public.roles
for each row execute function private.grant_cashier_ticket_capability();

comment on function private.require_pos_capabilities(uuid, text[])
is 'Shared permission-only POS capability guard. Preset and customer-created roles use the same role_permissions rows.';
comment on trigger enforce_open_ticket_capabilities on public.open_tickets
is 'Enforces pos.access, sales.create, and tickets.manage for all client ticket mutations, including direct RPC calls.';

commit;
