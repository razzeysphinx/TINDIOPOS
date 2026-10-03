-- Owner dashboard: permission-safe operational intelligence and honest cost coverage.
begin;

create or replace function public.get_dashboard_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snapshot jsonb;
  can_audit boolean := (select private.has_permission(target_organization_id, 'audit.view'));
  can_approve boolean := (select private.has_permission(target_organization_id, 'approvals.authorize'))
    or (select private.has_permission(target_organization_id, 'approvals.manage'));
  can_inventory boolean := (select private.has_permission(target_organization_id, 'inventory.view'))
    or (select private.has_permission(target_organization_id, 'inventory.manage'));
  can_review_cash boolean := (select private.has_permission(target_organization_id, 'shifts.view_history'))
    or (select private.has_permission(target_organization_id, 'settings.manage'))
    or (select private.has_permission(target_organization_id, 'shifts.close'));
begin
  snapshot := private.get_scoped_reporting_snapshot(
    target_organization_id,
    target_start_date,
    target_end_date,
    target_store_id,
    'dashboard.view'
  );

  -- The underlying reporting aggregate predates fine-grained dashboard cards.
  -- Replace restricted sections in the callable result so frontend hiding is
  -- never the security boundary.
  if not can_inventory then
    snapshot := jsonb_set(snapshot, '{inventory}', jsonb_build_object(
      'cost_access', false,
      'stock_item_count', 0,
      'on_hand_quantity', 0,
      'low_stock_count', 0,
      'out_of_stock_count', 0,
      'negative_stock_count', 0,
      'dead_stock_count', 0,
      'inventory_valuation_minor', null,
      'fast_movers', '[]'::jsonb,
      'slow_movers', '[]'::jsonb,
      'activity', jsonb_build_object(
        'manual_adjustment_count', 0,
        'purchase_receipt_count', 0,
        'transfer_count', 0
      ),
      'movement_by_type', '[]'::jsonb
    ));
  end if;

  if not can_audit then
    snapshot := jsonb_set(snapshot, '{security,void_count}', '0'::jsonb);
    snapshot := jsonb_set(snapshot, '{security,price_override_count}', '0'::jsonb);
    snapshot := jsonb_set(snapshot, '{security,high_discount_count}', '0'::jsonb);
    snapshot := jsonb_set(snapshot, '{security,events}', '[]'::jsonb);
  end if;
  if not (can_audit or can_approve) then
    snapshot := jsonb_set(snapshot, '{security,manager_approval_count}', '0'::jsonb);
  end if;
  if not can_review_cash then
    snapshot := jsonb_set(snapshot, '{security,cash_discrepancy_count}', '0'::jsonb);
    snapshot := jsonb_set(snapshot, '{security,cash_discrepancy_minor}', '0'::jsonb);
    snapshot := jsonb_set(snapshot, '{security,cash_discrepancy_absolute_minor}', '0'::jsonb);
  end if;
  if not can_inventory then
    snapshot := jsonb_set(snapshot, '{security,manual_inventory_change_count}', '0'::jsonb);
  end if;

  return snapshot;
end;
$$;

create or replace function public.get_dashboard_operational_snapshot(
  target_organization_id uuid,
  target_start_date date,
  target_end_date date,
  target_store_id uuid default null
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
  today_start timestamptz;
  tomorrow_start timestamptz;
  can_approve boolean;
  can_cost boolean;
  can_customers boolean;
  can_devices boolean;
  can_inventory boolean;
  can_manage_all_stores boolean;
  can_shifts boolean;
  can_team boolean;
  can_tickets boolean;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'dashboard.view')) then
    raise exception 'Dashboard access is required.' using errcode = '42501';
  end if;

  if target_start_date is null
     or target_end_date is null
     or target_end_date < target_start_date
     or target_end_date - target_start_date > 365 then
    raise exception 'Choose a dashboard range from one to 366 days.' using errcode = '22023';
  end if;

  select organization.timezone into organization_timezone
  from public.organizations organization
  where organization.id = target_organization_id;

  if organization_timezone is null then
    raise exception 'The organization could not be resolved.' using errcode = '23514';
  end if;

  can_manage_all_stores := (select private.has_permission(target_organization_id, 'stores.manage'));
  if target_store_id is not null and not exists (
    select 1 from public.stores store
    where store.id = target_store_id and store.organization_id = target_organization_id
  ) then
    raise exception 'Choose a store from this organization.' using errcode = '23514';
  end if;

  if not can_manage_all_stores then
    if target_store_id is null or not exists (
      select 1
      from public.employees employee
      join public.employee_stores assignment
        on assignment.employee_id = employee.id
       and assignment.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and assignment.store_id = target_store_id
    ) then
      raise exception 'Dashboard data is limited to an assigned store.' using errcode = '42501';
    end if;
  end if;

  can_approve := (select private.has_permission(target_organization_id, 'approvals.authorize'))
    or (select private.has_permission(target_organization_id, 'approvals.manage'))
    or (select private.has_permission(target_organization_id, 'audit.view'));
  can_cost := (select private.has_permission(target_organization_id, 'products.view_cost'));
  can_customers := (select private.has_permission(target_organization_id, 'customers.manage'));
  can_devices := (select private.has_permission(target_organization_id, 'devices.manage'));
  can_inventory := (select private.has_permission(target_organization_id, 'inventory.view'))
    or (select private.has_permission(target_organization_id, 'inventory.manage'));
  can_shifts := (select private.has_permission(target_organization_id, 'shifts.view_history'))
    or (select private.has_permission(target_organization_id, 'settings.manage'))
    or (select private.has_permission(target_organization_id, 'shifts.open'))
    or (select private.has_permission(target_organization_id, 'shifts.close'))
    or (select private.has_permission(target_organization_id, 'registers.manage'));
  can_team := (select private.has_permission(target_organization_id, 'employees.manage'))
    or (select private.has_permission(target_organization_id, 'settings.manage'));
  can_tickets := (select private.has_permission(target_organization_id, 'tickets.manage'));

  period_start := target_start_date::timestamp at time zone organization_timezone;
  period_end := (target_end_date + 1)::timestamp at time zone organization_timezone;
  today_start := ((now() at time zone organization_timezone)::date)::timestamp at time zone organization_timezone;
  tomorrow_start := (((now() at time zone organization_timezone)::date) + 1)::timestamp at time zone organization_timezone;

  return (
    with period_sales as materialized (
      select sale.id, sale.store_id, sale.customer_id, sale.total_minor
      from public.sales sale
      where sale.organization_id = target_organization_id
        and sale.completed_at >= period_start
        and sale.completed_at < period_end
        and (target_store_id is null or sale.store_id = target_store_id)
    ),
    period_refunds as materialized (
      select refund.store_id, refund.total_minor
      from public.refunds refund
      where refund.organization_id = target_organization_id
        and refund.completed_at >= period_start
        and refund.completed_at < period_end
        and (target_store_id is null or refund.store_id = target_store_id)
    ),
    sale_cost_coverage as (
      select
        count(*)::integer as sold_line_count,
        count(*) filter (where sale_item.unit_cost_minor = 0)::integer as missing_cost_line_count,
        count(distinct (sale_item.product_id, sale_item.variant_id))
          filter (where sale_item.unit_cost_minor = 0)::integer as missing_cost_item_count
      from public.sale_items sale_item
      join period_sales sale on sale.id = sale_item.sale_id
    ),
    inventory_positions as materialized (
      select
        level.store_id,
        level.quantity,
        level.average_cost_minor,
        coalesce(setting.low_stock_level, 0)::numeric as low_stock_level
      from public.inventory_levels level
      left join public.product_store_settings setting
        on setting.organization_id = level.organization_id
       and setting.store_id = level.store_id
       and setting.product_id = level.product_id
      where level.organization_id = target_organization_id
        and (target_store_id is null or level.store_id = target_store_id)
    ),
    store_sales as (
      select sale.store_id, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from period_sales sale group by sale.store_id
    ),
    store_refunds as (
      select refund.store_id, sum(refund.total_minor)::bigint as refunds_minor
      from period_refunds refund group by refund.store_id
    ),
    store_rows as (
      select
        store.id,
        store.name,
        coalesce(sale.transaction_count, 0)::integer as transaction_count,
        coalesce(sale.sales_minor, 0)::bigint as sales_minor,
        coalesce(refund.refunds_minor, 0)::bigint as refunds_minor
      from public.stores store
      left join store_sales sale on sale.store_id = store.id
      left join store_refunds refund on refund.store_id = store.id
      where store.organization_id = target_organization_id
        and store.is_active
        and (target_store_id is null or store.id = target_store_id)
    )
    select jsonb_build_object(
      'access', jsonb_build_object(
        'approvals', can_approve,
        'cost', can_cost,
        'customers', can_customers,
        'devices', can_devices,
        'inventory', can_inventory,
        'organization_wide', can_manage_all_stores,
        'shifts', can_shifts,
        'team', can_team,
        'tickets', can_tickets
      ),
      'cost', jsonb_build_object(
        'sold_line_count', case when can_cost then (select sold_line_count from sale_cost_coverage) else null end,
        'missing_sales_cost_line_count', case when can_cost then (select missing_cost_line_count from sale_cost_coverage) else null end,
        'missing_sales_cost_item_count', case when can_cost then (select missing_cost_item_count from sale_cost_coverage) else null end,
        'missing_inventory_cost_count', case when can_cost and can_inventory then (
          select count(*)::integer from inventory_positions position
          where position.quantity <> 0 and position.average_cost_minor = 0
        ) else null end
      ),
      'inventory', jsonb_build_object(
        'low_stock_count', case when can_inventory then (
          select count(*)::integer from inventory_positions position
          where position.quantity > 0
            and position.low_stock_level > 0
            and position.quantity <= position.low_stock_level
        ) else null end,
        'out_of_stock_count', case when can_inventory then (
          select count(*)::integer from inventory_positions position where position.quantity = 0
        ) else null end,
        'negative_stock_count', case when can_inventory then (
          select count(*)::integer from inventory_positions position where position.quantity < 0
        ) else null end
      ),
      'operations', jsonb_build_object(
        'active_register_count', case when can_shifts then (
          select count(*)::integer from public.registers register
          where register.organization_id = target_organization_id
            and register.is_active
            and (target_store_id is null or register.store_id = target_store_id)
        ) else null end,
        'open_register_count', case when can_shifts then (
          select count(distinct shift.register_id)::integer from public.shifts shift
          where shift.organization_id = target_organization_id
            and shift.status = 'open'
            and (target_store_id is null or shift.store_id = target_store_id)
        ) else null end,
        'active_shift_count', case when can_shifts then (
          select count(*)::integer from public.shifts shift
          where shift.organization_id = target_organization_id
            and shift.status = 'open'
            and (target_store_id is null or shift.store_id = target_store_id)
        ) else null end,
        'clocked_in_employee_count', case when can_team then (
          select count(distinct entry.employee_id)::integer from public.time_clock_entries entry
          where entry.organization_id = target_organization_id
            and entry.clocked_out_at is null
            and (target_store_id is null or entry.store_id = target_store_id)
        ) else null end,
        'pending_approval_count', case when can_approve then (
          select count(*)::integer from public.approval_requests request
          where request.organization_id = target_organization_id
            and request.status = 'PENDING'
            and request.expires_at > now()
            and (target_store_id is null or request.store_id is null or request.store_id = target_store_id)
        ) else null end,
        'sync_issue_count', case when can_devices then (
          select count(*)::integer from public.offline_sync_events event
          where event.organization_id = target_organization_id
            and event.state in ('CONFLICT', 'FAILED')
            and (target_store_id is null or event.store_id = target_store_id)
        ) else null end,
        'pending_sync_count', case when can_devices then (
          select count(*)::integer from public.offline_sync_events event
          where event.organization_id = target_organization_id
            and event.state in ('LOCAL_PENDING', 'SYNCING')
            and (target_store_id is null or event.store_id = target_store_id)
        ) else null end,
        'devices_not_seen_recently_count', case when can_devices then (
          select count(*)::integer from public.pos_devices device
          where device.organization_id = target_organization_id
            and device.status = 'active'
            and (device.last_seen_at is null or device.last_seen_at < now() - interval '15 minutes')
            and (target_store_id is null or device.store_id = target_store_id)
        ) else null end,
        'open_ticket_count', case when can_tickets then (
          select count(*)::integer from public.open_tickets ticket
          where ticket.organization_id = target_organization_id
            and ticket.status = 'open'
            and (target_store_id is null or ticket.store_id = target_store_id)
        ) else null end,
        'sales_today_count', (
          select count(*)::integer from public.sales sale
          where sale.organization_id = target_organization_id
            and sale.completed_at >= today_start
            and sale.completed_at < tomorrow_start
            and (target_store_id is null or sale.store_id = target_store_id)
        )
      ),
      'people', jsonb_build_object(
        'active_employee_count', case when can_team then (
          select count(*)::integer
          from public.employees employee
          where employee.organization_id = target_organization_id
            and employee.status = 'active'
            and (
              target_store_id is null
              or exists (
                select 1 from public.employee_stores assignment
                where assignment.organization_id = employee.organization_id
                  and assignment.employee_id = employee.id
                  and assignment.store_id = target_store_id
              )
            )
        ) else null end,
        'linked_customers_served', case when can_customers then (
          select count(distinct sale.customer_id)::integer from period_sales sale where sale.customer_id is not null
        ) else null end,
        'new_customer_count', case when can_customers then (
          select count(*)::integer from public.customers customer
          where customer.organization_id = target_organization_id
            and customer.created_at >= period_start
            and customer.created_at < period_end
            and exists (select 1 from period_sales sale where sale.customer_id = customer.id)
        ) else null end,
        'returning_customer_count', case when can_customers then (
          select count(distinct sale.customer_id)::integer
          from period_sales sale
          where sale.customer_id is not null
            and exists (
              select 1 from public.sales previous_sale
              where previous_sale.organization_id = target_organization_id
                and previous_sale.customer_id = sale.customer_id
                and previous_sale.completed_at < period_start
                and (target_store_id is null or previous_sale.store_id = target_store_id)
            )
        ) else null end
      ),
      'store_performance', case when can_manage_all_stores then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'store_id', row.id,
          'name', row.name,
          'transaction_count', row.transaction_count,
          'net_sales_minor', row.sales_minor - row.refunds_minor,
          'average_order_minor', case when row.transaction_count > 0 then round(row.sales_minor::numeric / row.transaction_count)::bigint else 0 end
        ) order by row.sales_minor - row.refunds_minor desc, row.name), '[]'::jsonb)
        from store_rows row
      ) else '[]'::jsonb end
    )
  );
end;
$$;

revoke all on function public.get_dashboard_operational_snapshot(uuid,date,date,uuid) from public, anon, service_role;
grant execute on function public.get_dashboard_operational_snapshot(uuid,date,date,uuid) to authenticated;

comment on function public.get_dashboard_operational_snapshot(uuid,date,date,uuid)
is 'Returns one permission- and store-scoped Owner Dashboard supplement for cost coverage, live operations, inventory health, stores, team, and customers.';

commit;
