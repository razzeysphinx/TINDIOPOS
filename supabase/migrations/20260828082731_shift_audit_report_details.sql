-- Authorized Back Office reconciliation reader for one immutable, closed
-- register shift. This adds no audit data: it composes the existing shift,
-- payment, refund, cash-movement, and append-only audit records.

begin;

create index if not exists audit_logs_organization_shift_metadata_created_idx
  on public.audit_logs (organization_id, ((metadata ->> 'shift_id')), created_at desc)
  where metadata ? 'shift_id';

create index if not exists audit_logs_organization_sale_metadata_created_idx
  on public.audit_logs (organization_id, ((metadata ->> 'sale_id')), created_at desc)
  where metadata ? 'sale_id';

create or replace function public.get_shift_audit_report(
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
  viewer_employee_id uuid;
  can_manage_settings boolean := false;
  can_view_history boolean := false;
  can_view_audit boolean := false;
  opened_by_name text;
  closed_by_name text;
  store_name text;
  register_name text;
  gross_sales_minor bigint := 0;
  discounts_minor bigint := 0;
  tax_minor bigint := 0;
  sales_total_minor bigint := 0;
  sale_count integer := 0;
  refunds_minor bigint := 0;
  refund_count integer := 0;
  payment_breakdown jsonb := '[]'::jsonb;
  cash_movement_rows jsonb := '[]'::jsonb;
  audit_rows jsonb := '[]'::jsonb;
begin
  if target_organization_id is null or target_shift_id is null then
    raise exception 'The shift audit report request is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null then
    raise exception 'Sign in is required to view a shift audit report.' using errcode = '42501';
  end if;

  select private.current_employee_id(target_organization_id)
  into viewer_employee_id;

  if viewer_employee_id is null then
    raise exception 'An active employee profile is required to view a shift audit report.' using errcode = '42501';
  end if;

  select shift.*
  into shift_record
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id;

  if shift_record.id is null or shift_record.status <> 'closed' then
    raise exception 'The closed shift was not found.' using errcode = 'P0002';
  end if;

  can_manage_settings := (select private.has_permission(target_organization_id, 'settings.manage'));
  can_view_history := (select private.has_permission(target_organization_id, 'shifts.view_history'));

  if not can_manage_settings and not can_view_history then
    raise exception 'Shift history permission is required.' using errcode = '42501';
  end if;

  if not can_manage_settings and not exists (
    select 1
    from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = viewer_employee_id
      and employee_store.store_id = shift_record.store_id
  ) then
    raise exception 'You are not assigned to this shift store.' using errcode = '42501';
  end if;

  select coalesce(profile.full_name, profile.email, 'Employee')
  into opened_by_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = shift_record.opened_by_employee_id
    and employee.organization_id = target_organization_id;

  select coalesce(profile.full_name, profile.email, 'Employee')
  into closed_by_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = shift_record.closed_by_employee_id
    and employee.organization_id = target_organization_id;

  select store.name
  into store_name
  from public.stores store
  where store.id = shift_record.store_id
    and store.organization_id = target_organization_id;

  select register.name
  into register_name
  from public.registers register
  where register.id = shift_record.register_id
    and register.organization_id = target_organization_id;

  select *
  into cash_record
  from private.calculate_shift_cash(shift_record.id);

  select
    coalesce(sum(sale.subtotal_minor), 0)::bigint,
    coalesce(sum(sale.discount_minor), 0)::bigint,
    coalesce(sum(sale.tax_minor), 0)::bigint,
    coalesce(sum(sale.total_minor), 0)::bigint,
    count(*)::integer
  into gross_sales_minor, discounts_minor, tax_minor, sales_total_minor, sale_count
  from public.sales sale
  where sale.organization_id = target_organization_id
    and sale.shift_id = shift_record.id;

  select
    coalesce(sum(refund.total_minor), 0)::bigint,
    count(*)::integer
  into refunds_minor, refund_count
  from public.refunds refund
  where refund.organization_id = target_organization_id
    and refund.shift_id = shift_record.id;

  with payment_activity as (
    select
      payment.payment_method_name_snapshot as payment_name,
      payment.payment_method_type_snapshot as payment_type,
      sum(payment.amount_minor)::bigint as sales_minor,
      0::bigint as refunds_minor,
      count(*)::integer as sale_payment_count,
      0::integer as refund_payment_count
    from public.payments payment
    join public.sales sale
      on sale.id = payment.sale_id
     and sale.organization_id = payment.organization_id
    where payment.organization_id = target_organization_id
      and sale.shift_id = shift_record.id
    group by payment.payment_method_name_snapshot, payment.payment_method_type_snapshot

    union all

    select
      refund_payment.payment_method_name_snapshot as payment_name,
      refund_payment.payment_method_type_snapshot as payment_type,
      0::bigint as sales_minor,
      sum(refund_payment.amount_minor)::bigint as refunds_minor,
      0::integer as sale_payment_count,
      count(*)::integer as refund_payment_count
    from public.refund_payments refund_payment
    join public.refunds refund
      on refund.id = refund_payment.refund_id
     and refund.organization_id = refund_payment.organization_id
    where refund_payment.organization_id = target_organization_id
      and refund.shift_id = shift_record.id
    group by refund_payment.payment_method_name_snapshot, refund_payment.payment_method_type_snapshot
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', breakdown.payment_name,
        'type', breakdown.payment_type,
        'salesMinor', breakdown.sales_minor,
        'refundsMinor', breakdown.refunds_minor,
        'netMinor', breakdown.sales_minor - breakdown.refunds_minor,
        'salePaymentCount', breakdown.sale_payment_count,
        'refundPaymentCount', breakdown.refund_payment_count
      )
      order by lower(breakdown.payment_name), breakdown.payment_type
    ),
    '[]'::jsonb
  )
  into payment_breakdown
  from (
    select
      payment_name,
      payment_type,
      sum(payment_activity.sales_minor)::bigint as sales_minor,
      sum(payment_activity.refunds_minor)::bigint as refunds_minor,
      sum(payment_activity.sale_payment_count)::integer as sale_payment_count,
      sum(payment_activity.refund_payment_count)::integer as refund_payment_count
    from payment_activity
    group by payment_name, payment_type
  ) breakdown;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', movement.id,
        'type', movement.movement_type,
        'amountMinor', movement.amount_minor,
        'reason', movement.reason,
        'createdAt', movement.created_at,
        'employee', coalesce(profile.full_name, profile.email, 'Employee')
      )
      order by movement.created_at desc, movement.id desc
    ),
    '[]'::jsonb
  )
  into cash_movement_rows
  from public.cash_movements movement
  left join public.employees employee
    on employee.id = movement.employee_id
   and employee.organization_id = movement.organization_id
  left join public.profiles profile on profile.id = employee.profile_id
  where movement.organization_id = target_organization_id
    and movement.shift_id = shift_record.id;

  can_view_audit := (select private.has_permission(target_organization_id, 'audit.view'));

  if can_view_audit then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', audit_event.id,
          'eventType', audit_event.event_type,
          'operationCode', audit_event.operation_code,
          'amountMinor', audit_event.amount_minor,
          'reason', audit_event.reason,
          'createdAt', audit_event.created_at,
          'actor', coalesce(profile.full_name, profile.email, 'System'),
          'metadata', audit_event.metadata
        )
        order by audit_event.created_at desc, audit_event.id desc
      ),
      '[]'::jsonb
    )
    into audit_rows
    from (
      select audit.*
      from public.audit_logs audit
      where audit.organization_id = target_organization_id
        and (
          audit.metadata ->> 'shift_id' = shift_record.id::text
          or audit.metadata ->> 'sale_id' in (
            select sale.id::text
            from public.sales sale
            where sale.organization_id = target_organization_id
              and sale.shift_id = shift_record.id
          )
        )
      order by audit.created_at desc, audit.id desc
      limit 100
    ) audit_event
    left join public.employees employee
      on employee.id = audit_event.actor_employee_id
     and employee.organization_id = audit_event.organization_id
    left join public.profiles profile on profile.id = employee.profile_id;
  end if;

  return jsonb_build_object(
    'shift', jsonb_build_object(
      'id', shift_record.id,
      'number', 'SHIFT-' || upper(left(shift_record.id::text, 8)),
      'store', coalesce(store_name, 'Store'),
      'register', coalesce(register_name, 'Register'),
      'openedBy', coalesce(opened_by_name, 'Employee'),
      'closedBy', coalesce(closed_by_name, 'Employee'),
      'openedAt', shift_record.opened_at,
      'closedAt', shift_record.closed_at,
      'openingCashMinor', shift_record.opening_cash_minor,
      'expectedCashMinor', shift_record.expected_cash_minor,
      'countedCashMinor', shift_record.counted_cash_minor,
      'differenceMinor', shift_record.difference_minor,
      'openingNote', shift_record.opening_note,
      'closingNote', shift_record.closing_note
    ),
    'cash', jsonb_build_object(
      'cashPaymentsMinor', cash_record.cash_sales_minor,
      'cashRefundsMinor', cash_record.cash_refunds_minor,
      'paidInMinor', cash_record.pay_ins_minor,
      'paidOutMinor', cash_record.pay_outs_minor,
      'calculatedExpectedCashMinor', cash_record.expected_cash_minor
    ),
    'sales', jsonb_build_object(
      'saleCount', sale_count,
      'grossSalesMinor', gross_sales_minor,
      'discountsMinor', discounts_minor,
      'taxMinor', tax_minor,
      'salesTotalMinor', sales_total_minor,
      'refundCount', refund_count,
      'refundsMinor', refunds_minor,
      'netSalesMinor', sales_total_minor - refunds_minor
    ),
    'paymentBreakdown', payment_breakdown,
    'cashMovements', cash_movement_rows,
    'audit', jsonb_build_object(
      'available', can_view_audit,
      'events', audit_rows,
      'lifecycle', jsonb_build_array(
        jsonb_build_object(
          'eventType', 'SHIFT_OPENED',
          'createdAt', shift_record.opened_at,
          'actor', coalesce(opened_by_name, 'Employee'),
          'reason', shift_record.opening_note
        ),
        jsonb_build_object(
          'eventType', 'SHIFT_CLOSED',
          'createdAt', shift_record.closed_at,
          'actor', coalesce(closed_by_name, 'Employee'),
          'reason', shift_record.closing_note
        )
      )
    )
  );
end;
$$;

revoke all on function public.get_shift_audit_report(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_shift_audit_report(uuid, uuid)
  to authenticated;

comment on function public.get_shift_audit_report(uuid, uuid) is
  'Permission-guarded Back Office audit report for an assigned-store, closed register shift. Audit-log events require audit.view; shift lifecycle uses immutable shift records.';

commit;
