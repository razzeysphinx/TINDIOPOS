-- TINDIO Phase 10: permission-gated reporting snapshots over immutable business ledgers.
begin;

create index sales_organization_completed_report_idx
  on public.sales (organization_id, completed_at desc);
create index refunds_organization_store_completed_report_idx
  on public.refunds (organization_id, store_id, completed_at desc);
create index inventory_movements_organization_store_created_report_idx
  on public.inventory_movements (organization_id, store_id, created_at desc);

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
    where store.id = target_store_id
      and store.organization_id = target_organization_id
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
        sum(sale_item.quantity)::bigint as quantity_sold,
        sum(sale_item.line_total_minor)::bigint as sales_minor
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
      group by sale_item.product_id, sale_item.variant_id, sale_item.product_name_snapshot, sale_item.variant_name_snapshot
    ),
    product_refunds as (
      select
        refund_item.product_id,
        refund_item.variant_id,
        sum(refund_item.quantity)::bigint as quantity_refunded,
        sum(refund_item.line_total_minor)::bigint as refunds_minor
      from public.refund_items refund_item
      join refunds_in_period refund on refund.id = refund_item.refund_id
      group by refund_item.product_id, refund_item.variant_id
    ),
    product_rows as (
      select
        coalesce(sale_row.product_id, refund_row.product_id) as product_id,
        coalesce(sale_row.variant_id, refund_row.variant_id) as variant_id,
        coalesce(sale_row.product_name, 'Refunded product') as product_name,
        coalesce(sale_row.quantity_sold, 0)::bigint as quantity_sold,
        coalesce(refund_row.quantity_refunded, 0)::bigint as quantity_refunded,
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
        sum(sale_item.quantity)::bigint as quantity_sold
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
      join public.products product
        on product.id = sale_item.product_id
       and product.organization_id = sale_item.organization_id
      left join public.categories category
        on category.id = product.category_id
       and category.organization_id = product.organization_id
      group by coalesce(category.name, 'Uncategorized')
    ),
    employee_rows as (
      select
        sale.cashier_employee_id,
        sale.cashier_name_snapshot as employee_name,
        count(*)::integer as transaction_count,
        sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.cashier_employee_id, sale.cashier_name_snapshot
    ),
    store_rows as (
      select
        sale.store_id,
        sale.store_name_snapshot as store_name,
        count(*)::integer as transaction_count,
        sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.store_id, sale.store_name_snapshot
    ),
    payment_rows as (
      select
        payment.payment_method_name_snapshot as payment_method_name,
        payment.payment_method_type_snapshot as payment_method_type,
        sum(payment.amount_minor)::bigint as amount_minor,
        count(*)::integer as payment_count
      from public.payments payment
      join sales_in_period sale on sale.id = payment.sale_id
      group by payment.payment_method_name_snapshot, payment.payment_method_type_snapshot
    ),
    inventory_movement_rows as (
      select
        movement.movement_type,
        count(*)::integer as movement_count,
        coalesce(sum(movement.quantity_delta), 0)::numeric as quantity_delta
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.created_at >= period_start
        and movement.created_at < period_end
        and (target_store_id is null or movement.store_id = target_store_id)
      group by movement.movement_type
    )
    select jsonb_build_object(
      'period', jsonb_build_object(
        'start_date', target_start_date,
        'end_date', target_end_date,
        'store_id', target_store_id,
        'timezone', organization_timezone
      ),
      'summary', (
        select jsonb_build_object(
          'gross_sales_minor', coalesce(sum(sale.subtotal_minor), 0)::bigint,
          'sales_total_minor', coalesce(sum(sale.total_minor), 0)::bigint,
          'refunds_minor', (select coalesce(sum(refund.total_minor), 0)::bigint from refunds_in_period refund),
          'net_sales_minor', coalesce(sum(sale.total_minor), 0)::bigint - (select coalesce(sum(refund.total_minor), 0)::bigint from refunds_in_period refund),
          'transaction_count', count(*)::integer,
          'average_order_minor', coalesce(round(sum(sale.total_minor)::numeric / nullif(count(*), 0)), 0)::bigint,
          'discounts_minor', coalesce(sum(sale.discount_minor), 0)::bigint,
          'taxes_minor', coalesce(sum(sale.tax_minor), 0)::bigint,
          'cost_access', can_view_cost,
          'estimated_gross_profit_minor', case when can_view_cost then (
            coalesce((
              select sum((sale_item.line_total_minor - sale_item.tax_minor) - coalesce(variant.cost_minor, product.cost_minor, 0) * sale_item.quantity)::bigint
              from public.sale_items sale_item
              join sales_in_period sale on sale.id = sale_item.sale_id
              join public.products product on product.id = sale_item.product_id and product.organization_id = sale_item.organization_id
              left join public.product_variants variant on variant.id = sale_item.variant_id and variant.product_id = sale_item.product_id and variant.organization_id = sale_item.organization_id
            ), 0) - coalesce((
              select sum(refund_item.line_total_minor - coalesce(variant.cost_minor, product.cost_minor, 0) * refund_item.quantity)::bigint
              from public.refund_items refund_item
              join refunds_in_period refund on refund.id = refund_item.refund_id
              join public.products product on product.id = refund_item.product_id and product.organization_id = refund_item.organization_id
              left join public.product_variants variant on variant.id = refund_item.variant_id and variant.product_id = refund_item.product_id and variant.organization_id = refund_item.organization_id
            ), 0)
          ) else null end
        )
        from sales_in_period sale
      ),
      'sales_by_day', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'date', coalesce(daily_sale.report_date, daily_refund.report_date),
          'sales_minor', coalesce(daily_sale.sales_minor, 0),
          'refunds_minor', coalesce(daily_refund.refunds_minor, 0),
          'net_sales_minor', coalesce(daily_sale.sales_minor, 0) - coalesce(daily_refund.refunds_minor, 0),
          'transaction_count', coalesce(daily_sale.transaction_count, 0)
        ) order by coalesce(daily_sale.report_date, daily_refund.report_date)), '[]'::jsonb)
        from daily_sales daily_sale
        full join daily_refunds daily_refund on daily_refund.report_date = daily_sale.report_date
      ),
      'top_products', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'product_id', product_row.product_id,
          'variant_id', product_row.variant_id,
          'name', product_row.product_name,
          'quantity_sold', product_row.quantity_sold,
          'quantity_refunded', product_row.quantity_refunded,
          'sales_minor', product_row.sales_minor,
          'refunds_minor', product_row.refunds_minor,
          'net_sales_minor', product_row.sales_minor - product_row.refunds_minor
        ) order by product_row.sales_minor - product_row.refunds_minor desc, product_row.product_name), '[]'::jsonb)
        from (select * from product_rows order by sales_minor - refunds_minor desc, product_name limit 10) product_row
      ),
      'sales_by_category', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', category_row.category_name,
          'sales_minor', category_row.sales_minor,
          'quantity_sold', category_row.quantity_sold
        ) order by category_row.sales_minor desc, category_row.category_name), '[]'::jsonb)
        from category_rows category_row
      ),
      'sales_by_employee', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'employee_id', employee_row.cashier_employee_id,
          'name', employee_row.employee_name,
          'transaction_count', employee_row.transaction_count,
          'sales_minor', employee_row.sales_minor
        ) order by employee_row.sales_minor desc, employee_row.employee_name), '[]'::jsonb)
        from employee_rows employee_row
      ),
      'sales_by_store', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'store_id', store_row.store_id,
          'name', store_row.store_name,
          'transaction_count', store_row.transaction_count,
          'sales_minor', store_row.sales_minor
        ) order by store_row.sales_minor desc, store_row.store_name), '[]'::jsonb)
        from store_rows store_row
      ),
      'payments', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', payment_row.payment_method_name,
          'type', payment_row.payment_method_type,
          'amount_minor', payment_row.amount_minor,
          'payment_count', payment_row.payment_count
        ) order by payment_row.amount_minor desc, payment_row.payment_method_name), '[]'::jsonb)
        from payment_rows payment_row
      ),
      'inventory', jsonb_build_object(
        'cost_access', can_view_cost,
        'stock_item_count', (
          select count(*)::integer
          from public.inventory_levels level
          where level.organization_id = target_organization_id
            and (target_store_id is null or level.store_id = target_store_id)
        ),
        'inventory_valuation_minor', case when can_view_cost then (
          select coalesce(sum(level.quantity * coalesce(variant.cost_minor, product.cost_minor, 0)), 0)
          from public.inventory_levels level
          join public.products product on product.id = level.product_id and product.organization_id = level.organization_id
          left join public.product_variants variant on variant.id = level.variant_id and variant.product_id = level.product_id and variant.organization_id = level.organization_id
          where level.organization_id = target_organization_id
            and (target_store_id is null or level.store_id = target_store_id)
        ) else null end,
        'movement_by_type', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'movement_type', inventory_row.movement_type,
            'movement_count', inventory_row.movement_count,
            'quantity_delta', inventory_row.quantity_delta
          ) order by inventory_row.movement_type), '[]'::jsonb)
          from inventory_movement_rows inventory_row
        )
      )
    )
  );
end;
$$;

create or replace function public.get_dashboard_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_reporting_snapshot(
    target_organization_id,
    target_start_date,
    target_end_date,
    target_store_id,
    'dashboard.view'
  );
$$;

create or replace function public.get_reports_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_reporting_snapshot(
    target_organization_id,
    target_start_date,
    target_end_date,
    target_store_id,
    'reports.view'
  );
$$;

revoke execute on function private.get_reporting_snapshot(uuid,date,date,uuid,text) from public, anon, service_role;
revoke execute on function public.get_dashboard_snapshot(uuid,date,date,uuid), public.get_reports_snapshot(uuid,date,date,uuid) from public, anon, service_role;
grant execute on function private.get_reporting_snapshot(uuid,date,date,uuid,text) to authenticated;
grant execute on function public.get_dashboard_snapshot(uuid,date,date,uuid), public.get_reports_snapshot(uuid,date,date,uuid) to authenticated;

commit;
