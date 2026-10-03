-- Improvement 10: extend the existing reporting snapshot with immutable COGS,
-- operational dimensions, inventory health, and accountable security metrics.
begin;

create index if not exists shifts_organization_closed_report_idx
  on public.shifts (organization_id, closed_at desc)
  where status = 'closed';

create or replace function private.get_reporting_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid,
  target_required_permission text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_timezone text;
  period_start timestamptz;
  period_end timestamptz;
  can_view_cost boolean;
begin
  if (select auth.uid()) is null
     or target_required_permission not in ('dashboard.view', 'reports.view')
     or not (select private.has_permission(target_organization_id, target_required_permission)) then
    raise exception 'Reporting access is required.' using errcode = '42501';
  end if;

  if target_start_date is null
     or target_end_date is null
     or target_end_date < target_start_date
     or target_end_date - target_start_date > 365 then
    raise exception 'Choose a report range from one to 366 days.' using errcode = '22023';
  end if;

  select organization.timezone into organization_timezone
  from public.organizations organization
  where organization.id = target_organization_id;

  if organization_timezone is null then
    raise exception 'The organization could not be resolved.' using errcode = '23514';
  end if;

  if target_store_id is not null and not exists (
    select 1 from public.stores store
    where store.id = target_store_id and store.organization_id = target_organization_id
  ) then
    raise exception 'Choose a store from this organization.' using errcode = '23514';
  end if;

  period_start := target_start_date::timestamp at time zone organization_timezone;
  period_end := (target_end_date + 1)::timestamp at time zone organization_timezone;
  can_view_cost := (select private.has_permission(target_organization_id, 'products.view_cost'));

  return (
    with sales_in_period as materialized (
      select sale.*
      from public.sales sale
      where sale.organization_id = target_organization_id
        and sale.completed_at >= period_start
        and sale.completed_at < period_end
        and (target_store_id is null or sale.store_id = target_store_id)
    ),
    refunds_in_period as materialized (
      select refund.*
      from public.refunds refund
      where refund.organization_id = target_organization_id
        and refund.completed_at >= period_start
        and refund.completed_at < period_end
        and (target_store_id is null or refund.store_id = target_store_id)
    ),
    financial_inputs as materialized (
      select
        coalesce(sum(sale.subtotal_minor), 0)::bigint as gross_sales_minor,
        coalesce(sum(sale.total_minor), 0)::bigint as sales_total_minor,
        coalesce(sum(sale.discount_minor), 0)::bigint as discounts_minor,
        coalesce(sum(sale.tax_minor), 0)::bigint as taxes_minor,
        count(*)::integer as transaction_count,
        coalesce(round(sum(sale.total_minor)::numeric / nullif(count(*), 0)), 0)::bigint as average_order_minor
      from sales_in_period sale
    ),
    sales_cogs as materialized (
      select coalesce(sum(sale_item.cogs_minor), 0)::bigint as cogs_minor
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
    ),
    refunded_cogs as materialized (
      select coalesce(sum(round(refund_item.quantity * sale_item.unit_cost_minor)), 0)::bigint as cogs_minor
      from public.refund_items refund_item
      join refunds_in_period refund on refund.id = refund_item.refund_id
      join public.sale_items sale_item on sale_item.id = refund_item.sale_item_id
    ),
    financial_rows as materialized (
      select
        financial.gross_sales_minor,
        financial.sales_total_minor,
        financial.discounts_minor,
        financial.taxes_minor,
        financial.transaction_count,
        financial.average_order_minor,
        (select coalesce(sum(refund.total_minor), 0)::bigint from refunds_in_period refund) as refunds_minor,
        (sales_cost.cogs_minor - refund_cost.cogs_minor)::bigint as cogs_minor
      from financial_inputs financial
      cross join sales_cogs sales_cost
      cross join refunded_cogs refund_cost
    ),
    daily_sales as (
      select
        (sale.completed_at at time zone organization_timezone)::date as report_date,
        sum(sale.total_minor)::bigint as sales_minor,
        count(*)::integer as transaction_count
      from sales_in_period sale
      group by 1
    ),
    daily_refunds as (
      select
        (refund.completed_at at time zone organization_timezone)::date as report_date,
        sum(refund.total_minor)::bigint as refunds_minor
      from refunds_in_period refund
      group by 1
    ),
    product_sales as (
      select
        sale_item.product_id,
        sale_item.variant_id,
        concat_ws(' / ', sale_item.product_name_snapshot, sale_item.variant_name_snapshot) as product_name,
        coalesce(sum(sale_item.quantity), 0)::numeric as quantity_sold,
        sum(sale_item.line_total_minor)::bigint as sales_minor
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
      group by sale_item.product_id, sale_item.variant_id, sale_item.product_name_snapshot, sale_item.variant_name_snapshot
    ),
    product_refunds as (
      select
        refund_item.product_id,
        refund_item.variant_id,
        coalesce(sum(refund_item.quantity), 0)::numeric as quantity_refunded,
        sum(refund_item.line_total_minor)::bigint as refunds_minor
      from public.refund_items refund_item
      join refunds_in_period refund on refund.id = refund_item.refund_id
      group by refund_item.product_id, refund_item.variant_id
    ),
    product_rows as materialized (
      select
        coalesce(sale_row.product_id, refund_row.product_id) as product_id,
        coalesce(sale_row.variant_id, refund_row.variant_id) as variant_id,
        coalesce(sale_row.product_name, 'Refunded product') as product_name,
        coalesce(sale_row.quantity_sold, 0)::numeric as quantity_sold,
        coalesce(refund_row.quantity_refunded, 0)::numeric as quantity_refunded,
        coalesce(sale_row.sales_minor, 0)::bigint as sales_minor,
        coalesce(refund_row.refunds_minor, 0)::bigint as refunds_minor
      from product_sales sale_row
      full join product_refunds refund_row
        on refund_row.product_id = sale_row.product_id
       and refund_row.variant_id is not distinct from sale_row.variant_id
    ),
    category_rows as (
      select
        coalesce(category.name, 'Uncategorized') as category_name,
        sum(sale_item.line_total_minor)::bigint as sales_minor,
        coalesce(sum(sale_item.quantity), 0)::numeric as quantity_sold
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
      join public.products product on product.id = sale_item.product_id and product.organization_id = sale_item.organization_id
      left join public.categories category on category.id = product.category_id and category.organization_id = product.organization_id
      group by coalesce(category.name, 'Uncategorized')
    ),
    employee_rows as (
      select sale.cashier_employee_id, sale.cashier_name_snapshot as employee_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.cashier_employee_id, sale.cashier_name_snapshot
    ),
    store_rows as (
      select sale.store_id, sale.store_name_snapshot as store_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.store_id, sale.store_name_snapshot
    ),
    register_rows as (
      select sale.register_id, sale.register_name_snapshot as register_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.register_id, sale.register_name_snapshot
    ),
    customer_rows as (
      select sale.customer_id, coalesce(customer.full_name, 'Former customer') as customer_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      left join public.customers customer on customer.id = sale.customer_id and customer.organization_id = sale.organization_id
      where sale.customer_id is not null
      group by sale.customer_id, coalesce(customer.full_name, 'Former customer')
    ),
    hourly_rows as (
      select
        extract(hour from sale.completed_at at time zone organization_timezone)::integer as hour_of_day,
        count(*)::integer as transaction_count,
        sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by 1
    ),
    payment_rows as (
      select payment.payment_method_name_snapshot as payment_method_name, payment.payment_method_type_snapshot as payment_method_type, sum(payment.amount_minor)::bigint as amount_minor, count(*)::integer as payment_count
      from public.payments payment
      join sales_in_period sale on sale.id = payment.sale_id
      group by payment.payment_method_name_snapshot, payment.payment_method_type_snapshot
    ),
    inventory_positions as materialized (
      select
        level.store_id,
        level.product_id,
        level.variant_id,
        level.quantity,
        level.average_cost_minor,
        coalesce(setting.low_stock_level, 0)::numeric as low_stock_level,
        concat_ws(' / ', product.name, variant.name) as item_name
      from public.inventory_levels level
      join public.products product on product.id = level.product_id and product.organization_id = level.organization_id
      left join public.product_variants variant on variant.id = level.variant_id and variant.product_id = level.product_id and variant.organization_id = level.organization_id
      left join public.product_store_settings setting on setting.organization_id = level.organization_id and setting.product_id = level.product_id and setting.store_id = level.store_id
      where level.organization_id = target_organization_id
        and (target_store_id is null or level.store_id = target_store_id)
    ),
    recent_sale_activity as materialized (
      select distinct movement.store_id, movement.product_id, movement.variant_id
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.movement_type = 'SALE'
        and movement.created_at >= now() - interval '90 days'
        and (target_store_id is null or movement.store_id = target_store_id)
    ),
    inventory_movement_rows as materialized (
      select movement.movement_type, count(*)::integer as movement_count, coalesce(sum(movement.quantity_delta), 0)::numeric as quantity_delta
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.created_at >= period_start
        and movement.created_at < period_end
        and (target_store_id is null or movement.store_id = target_store_id)
      group by movement.movement_type
    ),
    security_audit_rows as materialized (
      select audit.event_type, audit.operation_code
      from public.audit_logs audit
      where audit.organization_id = target_organization_id
        and audit.created_at >= period_start
        and audit.created_at < period_end
        and (target_store_id is null or audit.store_id = target_store_id)
    ),
    cash_discrepancy_rows as materialized (
      select shift.difference_minor
      from public.shifts shift
      where shift.organization_id = target_organization_id
        and shift.status = 'closed'
        and shift.closed_at >= period_start
        and shift.closed_at < period_end
        and (target_store_id is null or shift.store_id = target_store_id)
        and shift.difference_minor is not null
    )
    select jsonb_build_object(
      'period', jsonb_build_object('start_date', target_start_date, 'end_date', target_end_date, 'store_id', target_store_id, 'timezone', organization_timezone),
      'summary', (
        select jsonb_build_object(
          'gross_sales_minor', financial.gross_sales_minor,
          'sales_total_minor', financial.sales_total_minor,
          'refunds_minor', financial.refunds_minor,
          'net_sales_minor', financial.sales_total_minor - financial.refunds_minor,
          'transaction_count', financial.transaction_count,
          'average_order_minor', financial.average_order_minor,
          'discounts_minor', financial.discounts_minor,
          'taxes_minor', financial.taxes_minor,
          'cost_access', can_view_cost,
          'cogs_minor', case when can_view_cost then financial.cogs_minor else null end,
          'gross_profit_minor', case when can_view_cost then financial.sales_total_minor - financial.refunds_minor - financial.cogs_minor else null end,
          'gross_margin_bps', case when can_view_cost and financial.sales_total_minor - financial.refunds_minor <> 0 then round(((financial.sales_total_minor - financial.refunds_minor - financial.cogs_minor)::numeric / (financial.sales_total_minor - financial.refunds_minor)) * 10000)::integer else null end,
          'estimated_gross_profit_minor', case when can_view_cost then financial.sales_total_minor - financial.refunds_minor - financial.cogs_minor else null end
        ) from financial_rows financial
      ),
      'sales_by_day', (
        select coalesce(jsonb_agg(jsonb_build_object('date', coalesce(daily_sale.report_date, daily_refund.report_date), 'sales_minor', coalesce(daily_sale.sales_minor, 0), 'refunds_minor', coalesce(daily_refund.refunds_minor, 0), 'net_sales_minor', coalesce(daily_sale.sales_minor, 0) - coalesce(daily_refund.refunds_minor, 0), 'transaction_count', coalesce(daily_sale.transaction_count, 0)) order by coalesce(daily_sale.report_date, daily_refund.report_date)), '[]'::jsonb)
        from daily_sales daily_sale full join daily_refunds daily_refund on daily_refund.report_date = daily_sale.report_date
      ),
      'top_products', (
        select coalesce(jsonb_agg(jsonb_build_object('product_id', product_row.product_id, 'variant_id', product_row.variant_id, 'name', product_row.product_name, 'quantity_sold', product_row.quantity_sold, 'quantity_refunded', product_row.quantity_refunded, 'sales_minor', product_row.sales_minor, 'refunds_minor', product_row.refunds_minor, 'net_sales_minor', product_row.sales_minor - product_row.refunds_minor) order by product_row.sales_minor - product_row.refunds_minor desc, product_row.product_name), '[]'::jsonb)
        from (select * from product_rows order by sales_minor - refunds_minor desc, product_name limit 10) product_row
      ),
      'sales_by_category', (
        select coalesce(jsonb_agg(jsonb_build_object('name', category_row.category_name, 'sales_minor', category_row.sales_minor, 'quantity_sold', category_row.quantity_sold) order by category_row.sales_minor desc, category_row.category_name), '[]'::jsonb) from category_rows category_row
      ),
      'sales_by_employee', (
        select coalesce(jsonb_agg(jsonb_build_object('employee_id', employee_row.cashier_employee_id, 'name', employee_row.employee_name, 'transaction_count', employee_row.transaction_count, 'sales_minor', employee_row.sales_minor) order by employee_row.sales_minor desc, employee_row.employee_name), '[]'::jsonb) from employee_rows employee_row
      ),
      'sales_by_store', (
        select coalesce(jsonb_agg(jsonb_build_object('store_id', store_row.store_id, 'name', store_row.store_name, 'transaction_count', store_row.transaction_count, 'sales_minor', store_row.sales_minor) order by store_row.sales_minor desc, store_row.store_name), '[]'::jsonb) from store_rows store_row
      ),
      'sales_by_register', (
        select coalesce(jsonb_agg(jsonb_build_object('register_id', register_row.register_id, 'name', register_row.register_name, 'transaction_count', register_row.transaction_count, 'sales_minor', register_row.sales_minor) order by register_row.sales_minor desc, register_row.register_name), '[]'::jsonb) from register_rows register_row
      ),
      'sales_by_customer', (
        select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_row.customer_id, 'name', customer_row.customer_name, 'transaction_count', customer_row.transaction_count, 'sales_minor', customer_row.sales_minor) order by customer_row.sales_minor desc, customer_row.customer_name), '[]'::jsonb) from customer_rows customer_row
      ),
      'sales_by_hour', (
        select coalesce(jsonb_agg(jsonb_build_object('hour', hourly_row.hour_of_day, 'label', lpad(hourly_row.hour_of_day::text, 2, '0') || ':00', 'transaction_count', hourly_row.transaction_count, 'sales_minor', hourly_row.sales_minor) order by hourly_row.hour_of_day), '[]'::jsonb) from hourly_rows hourly_row
      ),
      'payments', (
        select coalesce(jsonb_agg(jsonb_build_object('name', payment_row.payment_method_name, 'type', payment_row.payment_method_type, 'amount_minor', payment_row.amount_minor, 'payment_count', payment_row.payment_count) order by payment_row.amount_minor desc, payment_row.payment_method_name), '[]'::jsonb) from payment_rows payment_row
      ),
      'inventory', jsonb_build_object(
        'cost_access', can_view_cost,
        'stock_item_count', (select count(*)::integer from inventory_positions),
        'on_hand_quantity', (select coalesce(sum(position.quantity), 0)::numeric from inventory_positions position),
        'low_stock_count', (select count(*)::integer from inventory_positions position where position.low_stock_level > 0 and position.quantity <= position.low_stock_level),
        'out_of_stock_count', (select count(*)::integer from inventory_positions position where position.quantity = 0),
        'negative_stock_count', (select count(*)::integer from inventory_positions position where position.quantity < 0),
        'dead_stock_count', (select count(*)::integer from inventory_positions position left join recent_sale_activity activity on activity.store_id = position.store_id and activity.product_id = position.product_id and activity.variant_id is not distinct from position.variant_id where position.quantity > 0 and activity.product_id is null),
        'inventory_valuation_minor', case when can_view_cost then (select coalesce(sum(position.quantity * position.average_cost_minor), 0)::bigint from inventory_positions position) else null end,
        'fast_movers', (select coalesce(jsonb_agg(jsonb_build_object('product_id', mover.product_id, 'variant_id', mover.variant_id, 'name', mover.product_name, 'quantity_sold', mover.quantity_sold - mover.quantity_refunded, 'net_sales_minor', mover.sales_minor - mover.refunds_minor) order by mover.quantity_sold - mover.quantity_refunded desc, mover.product_name), '[]'::jsonb) from (select * from product_rows where quantity_sold - quantity_refunded > 0 order by quantity_sold - quantity_refunded desc, product_name limit 5) mover),
        'slow_movers', (select coalesce(jsonb_agg(jsonb_build_object('product_id', mover.product_id, 'variant_id', mover.variant_id, 'name', mover.item_name, 'quantity_on_hand', mover.quantity, 'quantity_sold', mover.quantity_sold) order by mover.quantity_sold, mover.quantity desc, mover.item_name), '[]'::jsonb) from (select position.product_id, position.variant_id, position.item_name, position.quantity, coalesce(product_row.quantity_sold - product_row.quantity_refunded, 0) as quantity_sold from inventory_positions position left join product_rows product_row on product_row.product_id = position.product_id and product_row.variant_id is not distinct from position.variant_id where position.quantity > 0 and coalesce(product_row.quantity_sold - product_row.quantity_refunded, 0) > 0 order by coalesce(product_row.quantity_sold - product_row.quantity_refunded, 0), position.quantity desc, position.item_name limit 5) mover),
        'activity', jsonb_build_object(
          'manual_adjustment_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type in ('ADJUSTMENT', 'DAMAGE', 'LOSS', 'COUNT')), 0)::integer from inventory_movement_rows movement),
          'purchase_receipt_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type = 'RECEIPT'), 0)::integer from inventory_movement_rows movement),
          'transfer_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type in ('TRANSFER_IN', 'TRANSFER_OUT')), 0)::integer from inventory_movement_rows movement)
        ),
        'movement_by_type', (select coalesce(jsonb_agg(jsonb_build_object('movement_type', inventory_row.movement_type, 'movement_count', inventory_row.movement_count, 'quantity_delta', inventory_row.quantity_delta) order by inventory_row.movement_type), '[]'::jsonb) from inventory_movement_rows inventory_row)
      ),
      'security', jsonb_build_object(
        'refund_count', (select count(*)::integer from refunds_in_period),
        'void_count', (select count(*)::integer from security_audit_rows audit where audit.operation_code = 'sales.void' and audit.event_type = 'APPROVAL_CONSUMED'),
        'price_override_count', (select count(*)::integer from security_audit_rows audit where audit.operation_code = 'prices.override' and audit.event_type = 'APPROVAL_CONSUMED'),
        'high_discount_count', (select count(*)::integer from sales_in_period sale where sale.discount_minor > 0 and sale.discount_minor * 100 >= sale.subtotal_minor * 20),
        'manager_approval_count', (select count(*)::integer from security_audit_rows audit where audit.event_type = 'APPROVAL_APPROVED'),
        'cash_discrepancy_count', (select count(*)::integer from cash_discrepancy_rows),
        'cash_discrepancy_minor', (select coalesce(sum(difference_minor), 0)::bigint from cash_discrepancy_rows),
        'cash_discrepancy_absolute_minor', (select coalesce(sum(abs(difference_minor)), 0)::bigint from cash_discrepancy_rows),
        'manual_inventory_change_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type in ('ADJUSTMENT', 'DAMAGE', 'LOSS', 'COUNT')), 0)::integer from inventory_movement_rows movement),
        'events', (select coalesce(jsonb_agg(jsonb_build_object('event_type', event_row.event_type, 'event_count', event_row.event_count) order by event_row.event_count desc, event_row.event_type), '[]'::jsonb) from (select audit.event_type, count(*)::integer as event_count from security_audit_rows audit group by audit.event_type order by count(*) desc, audit.event_type limit 10) event_row)
      )
    )
  );
end;
$$;

revoke execute on function private.get_reporting_snapshot(uuid,date,date,uuid,text) from public, anon, service_role;
grant execute on function private.get_reporting_snapshot(uuid,date,date,uuid,text) to authenticated;

comment on function private.get_reporting_snapshot(uuid,date,date,uuid,text) is 'Permission-gated reporting snapshot from authoritative sales, refund, COGS, inventory, shift, and audit records.';

commit;
