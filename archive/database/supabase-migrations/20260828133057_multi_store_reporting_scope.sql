-- Multi-store Back Office filtering: make store ownership an authorization
-- boundary for records that belong to a branch. `stores.manage` remains the
-- established explicit organization-wide authority; every other role is
-- limited to its employee-store assignments.
begin;

create or replace function private.has_store_read_scope(
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
    and target_store_id is not null
    and (
      (select private.has_permission(target_organization_id, 'stores.manage'))
      or exists (
        select 1
        from public.employees employee
        join public.employee_stores assignment
          on assignment.organization_id = employee.organization_id
         and assignment.employee_id = employee.id
        where employee.organization_id = target_organization_id
          and employee.profile_id = (select auth.uid())
          and employee.status = 'active'
          and assignment.store_id = target_store_id
      )
    );
$$;

create or replace function private.has_sale_read_scope(
  target_organization_id uuid,
  target_sale_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sales sale
    where sale.id = target_sale_id
      and sale.organization_id = target_organization_id
      and (select private.has_store_read_scope(target_organization_id, sale.store_id))
  );
$$;

create or replace function private.has_refund_read_scope(
  target_organization_id uuid,
  target_refund_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.refunds refund
    where refund.id = target_refund_id
      and refund.organization_id = target_organization_id
      and (select private.has_store_read_scope(target_organization_id, refund.store_id))
  );
$$;

create or replace function private.has_purchase_order_read_scope(
  target_organization_id uuid,
  target_purchase_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_orders purchase_order
    where purchase_order.id = target_purchase_order_id
      and purchase_order.organization_id = target_organization_id
      and (select private.has_store_read_scope(target_organization_id, purchase_order.store_id))
  );
$$;

create or replace function private.has_stock_request_read_scope(
  target_organization_id uuid,
  target_stock_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stock_requests stock_request
    where stock_request.id = target_stock_request_id
      and stock_request.organization_id = target_organization_id
      and (select private.has_store_read_scope(target_organization_id, stock_request.requesting_store_id))
  );
$$;

create or replace function private.has_stock_transfer_read_scope(
  target_organization_id uuid,
  target_stock_transfer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stock_transfers stock_transfer
    where stock_transfer.id = target_stock_transfer_id
      and stock_transfer.organization_id = target_organization_id
      and (
        (select private.has_store_read_scope(target_organization_id, stock_transfer.source_store_id))
        or (select private.has_store_read_scope(target_organization_id, stock_transfer.destination_store_id))
      )
  );
$$;

create or replace function private.can_access_employee_store_scope(
  target_organization_id uuid,
  target_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.has_permission(target_organization_id, 'stores.manage'))
    or exists (
      select 1
      from public.employee_stores target_assignment
      join public.employee_stores viewer_assignment
        on viewer_assignment.organization_id = target_assignment.organization_id
       and viewer_assignment.store_id = target_assignment.store_id
      where target_assignment.organization_id = target_organization_id
        and target_assignment.employee_id = target_employee_id
        and viewer_assignment.employee_id = (select private.current_employee_id(target_organization_id))
    );
$$;

create or replace function private.can_view_employee_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_profile_id = (select auth.uid())
    or exists (
      select 1
      from public.employees target_employee
      where target_employee.profile_id = target_profile_id
        and (select private.has_permission(target_employee.organization_id, 'employees.manage'))
        and (select private.can_access_employee_store_scope(target_employee.organization_id, target_employee.id))
    );
$$;

revoke all on function private.has_store_read_scope(uuid, uuid),
  private.has_sale_read_scope(uuid, uuid),
  private.has_refund_read_scope(uuid, uuid),
  private.has_purchase_order_read_scope(uuid, uuid),
  private.has_stock_request_read_scope(uuid, uuid),
  private.has_stock_transfer_read_scope(uuid, uuid),
  private.can_access_employee_store_scope(uuid, uuid)
from public, anon, service_role;
grant execute on function private.has_store_read_scope(uuid, uuid),
  private.has_sale_read_scope(uuid, uuid),
  private.has_refund_read_scope(uuid, uuid),
  private.has_purchase_order_read_scope(uuid, uuid),
  private.has_stock_request_read_scope(uuid, uuid),
  private.has_stock_transfer_read_scope(uuid, uuid),
  private.can_access_employee_store_scope(uuid, uuid)
to authenticated;

drop policy if exists stores_select_member on public.stores;
create policy stores_select_authorized_scope on public.stores
  for select to authenticated
  using (
    (select private.is_organization_creator(organization_id))
    or (select private.has_store_read_scope(organization_id, id))
  );

drop policy if exists registers_select_member on public.registers;
create policy registers_select_authorized_scope on public.registers
  for select to authenticated
  using (
    (select private.is_organization_creator(organization_id))
    or (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists sales_select_receipts_authorized on public.sales;
create policy sales_select_receipts_authorized on public.sales
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists receipts_select_receipts_authorized on public.receipts;
create policy receipts_select_receipts_authorized on public.receipts
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_sale_read_scope(organization_id, sale_id))
  );

drop policy if exists sale_items_select_receipts_authorized on public.sale_items;
create policy sale_items_select_receipts_authorized on public.sale_items
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_sale_read_scope(organization_id, sale_id))
  );

drop policy if exists payments_select_receipts_authorized on public.payments;
create policy payments_select_receipts_authorized on public.payments
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_sale_read_scope(organization_id, sale_id))
  );

drop policy if exists refunds_select_receipts_authorized on public.refunds;
create policy refunds_select_receipts_authorized on public.refunds
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists refund_items_select_receipts_authorized on public.refund_items;
create policy refund_items_select_receipts_authorized on public.refund_items
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_refund_read_scope(organization_id, refund_id))
  );

drop policy if exists refund_payments_select_receipts_authorized on public.refund_payments;
create policy refund_payments_select_receipts_authorized on public.refund_payments
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_refund_read_scope(organization_id, refund_id))
  );

drop policy if exists sale_exchanges_select_receipts_authorized on public.sale_exchanges;
create policy sale_exchanges_select_receipts_authorized on public.sale_exchanges
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.view'))
    and (select private.has_refund_read_scope(organization_id, refund_id))
  );

drop policy if exists receipt_delivery_requests_select_reprint_authorized on public.receipt_delivery_requests;
create policy receipt_delivery_requests_select_reprint_authorized on public.receipt_delivery_requests
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'receipts.reprint'))
    and exists (
      select 1
      from public.receipts receipt
      where receipt.id = receipt_delivery_requests.receipt_id
        and receipt.organization_id = receipt_delivery_requests.organization_id
        and (select private.has_sale_read_scope(receipt.organization_id, receipt.sale_id))
    )
  );

drop policy if exists inventory_levels_select_member on public.inventory_levels;
create policy inventory_levels_select_authorized_scope on public.inventory_levels
  for select to authenticated
  using (
    (select private.is_organization_member(organization_id))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists product_store_settings_select_member on public.product_store_settings;
create policy product_store_settings_select_authorized_scope on public.product_store_settings
  for select to authenticated
  using (
    (select private.is_organization_member(organization_id))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists inventory_movements_select_authorized on public.inventory_movements;
create policy inventory_movements_select_authorized on public.inventory_movements
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists inventory_policies_select_manager on public.inventory_policies;
create policy inventory_policies_select_manager on public.inventory_policies
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists inventory_replenishment_rules_select_inventory_manager on public.inventory_replenishment_rules;
create policy inventory_replenishment_rules_select_inventory_manager on public.inventory_replenishment_rules
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists supply_chain_warehouses_select_inventory_manager on public.supply_chain_warehouses;
create policy supply_chain_warehouses_select_inventory_manager on public.supply_chain_warehouses
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists purchase_orders_select_inventory_manager on public.purchase_orders;
create policy purchase_orders_select_inventory_manager on public.purchase_orders
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists purchase_order_lines_select_inventory_manager on public.purchase_order_lines;
create policy purchase_order_lines_select_inventory_manager on public.purchase_order_lines
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_purchase_order_read_scope(organization_id, purchase_order_id))
  );

drop policy if exists stock_requests_select_inventory_manager on public.stock_requests;
create policy stock_requests_select_inventory_manager on public.stock_requests
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, requesting_store_id))
  );

drop policy if exists stock_request_lines_select_inventory_manager on public.stock_request_lines;
create policy stock_request_lines_select_inventory_manager on public.stock_request_lines
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_stock_request_read_scope(organization_id, stock_request_id))
  );

drop policy if exists stock_transfers_select_inventory_manager on public.stock_transfers;
create policy stock_transfers_select_inventory_manager on public.stock_transfers
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (
      (select private.has_store_read_scope(organization_id, source_store_id))
      or (select private.has_store_read_scope(organization_id, destination_store_id))
    )
  );

drop policy if exists stock_transfer_lines_select_inventory_manager on public.stock_transfer_lines;
create policy stock_transfer_lines_select_inventory_manager on public.stock_transfer_lines
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_stock_transfer_read_scope(organization_id, stock_transfer_id))
  );

drop policy if exists pos_devices_select_managers on public.pos_devices;
create policy pos_devices_select_managers on public.pos_devices
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'devices.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists offline_sync_events_select_device_managers on public.offline_sync_events;
create policy offline_sync_events_select_device_managers on public.offline_sync_events
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'devices.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists audit_logs_select_authorized on public.audit_logs;
create policy audit_logs_select_authorized on public.audit_logs
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'audit.view'))
    and (
      (store_id is not null and (select private.has_store_read_scope(organization_id, store_id)))
      or (store_id is null and (select private.has_permission(organization_id, 'stores.manage')))
    )
  );

drop policy if exists time_clock_entries_select_self_or_settings_manager on public.time_clock_entries;
create policy time_clock_entries_select_self_or_settings_manager on public.time_clock_entries
  for select to authenticated
  using (
    employee_id = (select private.current_employee_id(organization_id))
    or (
      (select private.has_permission(organization_id, 'settings.manage'))
      and (select private.has_store_read_scope(organization_id, store_id))
    )
  );

drop policy if exists employees_select_authorized on public.employees;
create policy employees_select_authorized on public.employees
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      (select private.has_permission(organization_id, 'employees.manage'))
      and (select private.can_access_employee_store_scope(organization_id, id))
    )
  );

drop policy if exists employee_stores_select_authorized on public.employee_stores;
create policy employee_stores_select_authorized on public.employee_stores
  for select to authenticated
  using (
    employee_id = (select private.current_employee_id(organization_id))
    or (
      (select private.has_permission(organization_id, 'employees.manage'))
      and (select private.has_store_read_scope(organization_id, store_id))
    )
  );

drop policy if exists employee_roles_select_authorized on public.employee_roles;
create policy employee_roles_select_authorized on public.employee_roles
  for select to authenticated
  using (
    employee_id = (select private.current_employee_id(organization_id))
    or (
      (select private.has_permission(organization_id, 'employees.manage'))
      and (select private.can_access_employee_store_scope(organization_id, employee_id))
    )
  );

commit;
