-- Complete POS shift summary for the operational UI and shift-close print.
-- The calculation remains server-side and reads only immutable transaction and
-- cash-movement records; browser totals are never authoritative.

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
    when shift_record.status = 'open' and not coalesce(show_expected_before_close, true) then null
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

revoke all on function public.get_pos_shift_operational_summary(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_pos_shift_operational_summary(uuid, uuid)
  to authenticated;

comment on function public.get_pos_shift_operational_summary(uuid, uuid) is
  'Server-derived POS shift, cash-drawer, and sales summary for authorized assigned-store shift users. Blind cash remains hidden while a blind-count shift is open.';
