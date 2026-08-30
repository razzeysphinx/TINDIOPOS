-- Phase 8: inventory read access and cost visibility hardening.
-- Existing inventory mutations deliberately retain their established
-- inventory.manage/RPC gates. This migration only grants safe read access to
-- the existing inventory.view capability and moves sensitive values behind
-- explicit, store-scoped permission checks.

begin;

drop policy if exists inventory_levels_select_member on public.inventory_levels;
drop policy if exists inventory_levels_select_authorized_scope on public.inventory_levels;
create policy inventory_levels_select_authorized_scope on public.inventory_levels
  for select to authenticated
  using (
    (
      (select private.has_permission(organization_id, 'inventory.view'))
      or (select private.has_permission(organization_id, 'inventory.manage'))
    )
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists inventory_movements_select_authorized on public.inventory_movements;
create policy inventory_movements_select_authorized on public.inventory_movements
  for select to authenticated
  using (
    (
      (select private.has_permission(organization_id, 'inventory.view'))
      or (select private.has_permission(organization_id, 'inventory.manage'))
    )
    and (select private.has_store_read_scope(organization_id, store_id))
  );

-- Keep raw acquisition and valuation fields unavailable to the authenticated
-- table role. The functions below are the only application access paths and
-- check both products.view_cost and the caller's assigned-store scope.
revoke select on table public.inventory_levels from authenticated;
grant select (
  id, organization_id, store_id, product_id, variant_id, quantity, updated_at
) on table public.inventory_levels to authenticated;

revoke select on table public.inventory_movements from authenticated;
grant select (
  id, organization_id, store_id, product_id, variant_id, quantity_delta,
  quantity_before, quantity_after, movement_type, actor_employee_id, reason,
  reason_code, source_type, source_id, created_at
) on table public.inventory_movements to authenticated;

revoke select on table public.purchase_order_lines from authenticated;
grant select (
  id, organization_id, purchase_order_id, product_id, variant_id,
  product_name_snapshot, variant_name_snapshot, unit_snapshot,
  ordered_quantity, received_quantity
) on table public.purchase_order_lines to authenticated;

revoke select on table public.stock_transfer_lines from authenticated;
grant select (
  id, organization_id, stock_transfer_id, stock_request_line_id, product_id,
  variant_id, quantity, received_quantity, short_quantity
) on table public.stock_transfer_lines to authenticated;

revoke select on table public.supplier_return_lines from authenticated;
grant select (
  id, organization_id, supplier_return_id, product_id, variant_id, quantity
) on table public.supplier_return_lines to authenticated;

create or replace function public.get_inventory_valuation(target_organization_id uuid)
returns table (
  store_id uuid,
  product_id uuid,
  variant_id uuid,
  quantity numeric,
  average_cost_minor bigint,
  value_minor bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    level.store_id,
    level.product_id,
    level.variant_id,
    level.quantity,
    level.average_cost_minor,
    round(level.quantity * level.average_cost_minor)::bigint as value_minor
  from public.inventory_levels level
  where (select auth.uid()) is not null
    and level.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'products.view_cost'))
    and (
      (select private.has_permission(target_organization_id, 'inventory.view'))
      or (select private.has_permission(target_organization_id, 'inventory.manage'))
    )
    and (select private.has_store_read_scope(target_organization_id, level.store_id));
$$;

create or replace function public.get_inventory_movement_costs(
  target_organization_id uuid,
  requested_movement_ids uuid[]
)
returns table (
  id uuid,
  unit_cost_minor bigint,
  value_delta_minor bigint
)
language sql
security definer
set search_path = ''
as $$
  select movement.id, movement.unit_cost_minor, movement.value_delta_minor
  from public.inventory_movements movement
  where (select auth.uid()) is not null
    and cardinality(requested_movement_ids) between 1 and 100
    and movement.id = any(requested_movement_ids)
    and movement.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'products.view_cost'))
    and (
      (select private.has_permission(target_organization_id, 'inventory.view'))
      or (select private.has_permission(target_organization_id, 'inventory.manage'))
    )
    and (select private.has_store_read_scope(target_organization_id, movement.store_id));
$$;

create or replace function public.get_purchase_order_line_costs(
  target_organization_id uuid,
  requested_purchase_order_line_ids uuid[]
)
returns table (
  id uuid,
  unit_cost_minor bigint
)
language sql
security definer
set search_path = ''
as $$
  select line.id, line.unit_cost_minor
  from public.purchase_order_lines line
  join public.purchase_orders purchase
    on purchase.id = line.purchase_order_id
   and purchase.organization_id = line.organization_id
  where (select auth.uid()) is not null
    and cardinality(requested_purchase_order_line_ids) between 1 and 100
    and line.id = any(requested_purchase_order_line_ids)
    and line.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'products.view_cost'))
    and (select private.has_permission(target_organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(target_organization_id, purchase.store_id));
$$;

revoke all on function public.get_inventory_valuation(uuid) from public, anon;
revoke all on function public.get_inventory_movement_costs(uuid, uuid[]) from public, anon;
revoke all on function public.get_purchase_order_line_costs(uuid, uuid[]) from public, anon;
grant execute on function public.get_inventory_valuation(uuid) to authenticated;
grant execute on function public.get_inventory_movement_costs(uuid, uuid[]) to authenticated;
grant execute on function public.get_purchase_order_line_costs(uuid, uuid[]) to authenticated;

comment on function public.get_inventory_valuation(uuid) is
  'Returns store-scoped inventory valuation only to inventory readers with products.view_cost.';
comment on function public.get_inventory_movement_costs(uuid, uuid[]) is
  'Returns requested immutable movement values only to store-scoped inventory readers with products.view_cost.';
comment on function public.get_purchase_order_line_costs(uuid, uuid[]) is
  'Returns purchase-order line costs only to store-scoped inventory managers with products.view_cost.';

commit;
