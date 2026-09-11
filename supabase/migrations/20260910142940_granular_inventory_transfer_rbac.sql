-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.status = 'active'
    )
    and exists (
      select 1
      from public.employees employee
      join public.employee_roles employee_role
        on employee_role.employee_id = employee.id
       and employee_role.organization_id = employee.organization_id
      join public.role_permissions role_permission
        on role_permission.role_id = employee_role.role_id
       and role_permission.organization_id = employee_role.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

create or replace function private.has_all_inventory_capabilities(
  target_organization_id uuid,
  requested_capabilities text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(requested_capabilities) > 0
    and not exists (
      select 1
      from unnest(requested_capabilities) capability(code)
      where not (select private.has_inventory_capability(target_organization_id, capability.code))
    ),
    false
  );
$$;

create or replace function private.has_any_inventory_capability(
  target_organization_id uuid,
  requested_capabilities text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(requested_capabilities) > 0
    and exists (
      select 1
      from unnest(requested_capabilities) capability(code)
      where (select private.has_inventory_capability(target_organization_id, capability.code))
    ),
    false
  );
$$;

-- Existing inventory procedures retain their exact business implementation.
-- A function-level setting cannot be supplied by a browser RPC caller; the
-- central permission predicate consumes it only while the tagged procedure is
-- executing.  This allows one canonical operation to move to a granular
-- capability without cloning or weakening the existing procedure.
create or replace function private.has_permission(
  target_organization_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.status = 'active'
    )
    and (
      exists (
        select 1
        from public.employees employee
        join public.employee_roles employee_role
          on employee_role.employee_id = employee.id
         and employee_role.organization_id = employee.organization_id
        join public.role_permissions role_permission
          on role_permission.role_id = employee_role.role_id
         and role_permission.organization_id = employee_role.organization_id
        where employee.organization_id = target_organization_id
          and employee.profile_id = (select auth.uid())
          and employee.status = 'active'
          and role_permission.permission_code = requested_permission
      )
      or (
        current_setting('tindio.approval_profile_id', true) = (select auth.uid())::text
        and current_setting('tindio.approval_organization_id', true) = target_organization_id::text
        and current_setting('tindio.approval_permission', true) = requested_permission
      )
      or (
        requested_permission = 'inventory.manage'
        and coalesce(current_setting('tindio.inventory_required_capabilities', true), '') <> ''
        and (
          select private.has_all_inventory_capabilities(
            target_organization_id,
            string_to_array(current_setting('tindio.inventory_required_capabilities', true), ',')
          )
        )
      )
    ),
    false
  );
$$;

-- Transfer procedures remain the single place that performs state changes.
-- Their legacy `inventory.manage` guard is now satisfied only by their named
-- capabilities (or by a pre-existing inventory.manage bundle).
alter function private.transfer_stock(uuid, uuid, uuid, jsonb, text)
  set tindio.inventory_required_capabilities to 'inventory.transfer.create,inventory.transfer.send';
alter function private.create_stock_request(uuid, uuid, uuid, text, jsonb, uuid)
  set tindio.inventory_required_capabilities to 'inventory.transfer.create';
alter function private.approve_stock_request(uuid, uuid, jsonb)
  set tindio.inventory_required_capabilities to 'inventory.transfer.send';
alter function private.start_stock_request_picking(uuid, uuid)
  set tindio.inventory_required_capabilities to 'inventory.transfer.send';
alter function private.dispatch_stock_request(uuid, uuid, text, uuid)
  set tindio.inventory_required_capabilities to 'inventory.transfer.send';
alter function private.receive_stock_request(uuid, uuid, jsonb, text, uuid)
  set tindio.inventory_required_capabilities to 'inventory.transfer.receive';
alter function private.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid)
  set tindio.inventory_required_capabilities to 'inventory.transfer.create,inventory.transfer.send';
alter function private.receive_stock_transfer(uuid, uuid, jsonb, text, uuid)
  set tindio.inventory_required_capabilities to 'inventory.transfer.receive';

-- A sender must be able to discover the request that targets its authorized
-- warehouse, while a receiver continues to see requests for its destination.
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
    left join public.supply_chain_warehouses warehouse
      on warehouse.id = stock_request.source_warehouse_id
     and warehouse.organization_id = stock_request.organization_id
    where stock_request.id = target_stock_request_id
      and stock_request.organization_id = target_organization_id
      and (
        (select private.has_store_read_scope(target_organization_id, stock_request.requesting_store_id))
        or (warehouse.store_id is not null and (select private.has_store_read_scope(target_organization_id, warehouse.store_id)))
      )
  );
$$;

-- Transfer documents remain readable only where both a transfer capability and
-- the existing source/destination store scope grant access.
drop policy if exists stock_requests_select_inventory_manager on public.stock_requests;
create policy stock_requests_select_inventory_transfer_scope
  on public.stock_requests
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_request_read_scope(organization_id, id))
  );

drop policy if exists stock_request_lines_select_inventory_manager on public.stock_request_lines;
create policy stock_request_lines_select_inventory_transfer_scope
  on public.stock_request_lines
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_request_read_scope(organization_id, stock_request_id))
  );

drop policy if exists stock_transfers_select_inventory_manager on public.stock_transfers;
create policy stock_transfers_select_inventory_transfer_scope
  on public.stock_transfers
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_transfer_read_scope(organization_id, id))
  );

drop policy if exists stock_transfer_lines_select_inventory_manager on public.stock_transfer_lines;
create policy stock_transfer_lines_select_inventory_transfer_scope
  on public.stock_transfer_lines
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_transfer_read_scope(organization_id, stock_transfer_id))
  );

drop policy if exists stock_transfer_receipts_select_manager on public.stock_transfer_receipts;
create policy stock_transfer_receipts_select_inventory_transfer_scope
  on public.stock_transfer_receipts
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_transfer_read_scope(organization_id, stock_transfer_id))
  );

drop policy if exists stock_transfer_receipt_lines_select_manager on public.stock_transfer_receipt_lines;
create policy stock_transfer_receipt_lines_select_inventory_transfer_scope
  on public.stock_transfer_receipt_lines
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and exists (
      select 1
      from public.stock_transfer_receipts receipt
      where receipt.id = stock_transfer_receipt_lines.stock_transfer_receipt_id
        and receipt.organization_id = stock_transfer_receipt_lines.organization_id
        and (select private.has_stock_transfer_read_scope(receipt.organization_id, receipt.stock_transfer_id))
    )
  );

drop policy if exists stock_request_discrepancies_select_inventory_manager on public.stock_request_discrepancies;
create policy stock_request_discrepancies_select_inventory_transfer_scope
  on public.stock_request_discrepancies
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_request_read_scope(organization_id, stock_request_id))
  );

-- A request creator needs the authorized source warehouse name and identifier
-- to create a canonical request. Configuration mutations remain protected by
-- inventory.manage and are intentionally not broadened here.
drop policy if exists supply_chain_warehouses_select_inventory_manager on public.supply_chain_warehouses;
create policy supply_chain_warehouses_select_inventory_transfer_scope
  on public.supply_chain_warehouses
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send']
    ))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

revoke all on function private.has_inventory_capability(uuid, text),
  private.has_all_inventory_capabilities(uuid, text[]),
  private.has_any_inventory_capability(uuid, text[])
from public, anon, service_role;
grant execute on function private.has_inventory_capability(uuid, text),
  private.has_all_inventory_capabilities(uuid, text[]),
  private.has_any_inventory_capability(uuid, text[])
to authenticated;

comment on function private.has_inventory_capability(uuid, text) is
  'Capability-based inventory authorization with explicit legacy inventory permission compatibility. No role names are used.';
comment on function private.has_all_inventory_capabilities(uuid, text[]) is
  'Requires every listed inventory capability for the active employee in the active organization.';
comment on function private.has_any_inventory_capability(uuid, text[]) is
  'Returns whether the active employee has any listed inventory capability in the active organization.';

notify pgrst, 'reload schema';

commit;
