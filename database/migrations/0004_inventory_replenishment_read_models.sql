begin;

create or replace function public.get_inventory_workspace_bundle_v1(
  target_organization_id uuid,
  target_store_ids uuid[] default null,
  requested_needs text[] default array[]::text[],
  requested_activity_from timestamptz default null,
  requested_activity_to timestamptz default null,
  requested_activity_movement_type text default null,
  requested_activity_source_type text default null,
  requested_activity_source_id text default null,
  requested_activity_limit integer default 30,
  requested_activity_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_needs text[] := coalesce(requested_needs, array[]::text[]);
  v_result jsonb := jsonb_build_object('openPurchaseOrdersCount', 0, 'archivedProductCount', 0);
  v_store_filter uuid[] := target_store_ids;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required' using errcode = '22004';
  end if;

  -- SECURITY INVOKER deliberately retains the caller's grants and RLS policies.
  if 'stores' = any(v_needs) then v_result := v_result || jsonb_build_object('stores', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (select id, name, is_active, created_at from public.stores where organization_id = target_organization_id and is_active and (v_store_filter is null or id = any(v_store_filter))) x), '[]'::jsonb)); end if;
  if 'categories' = any(v_needs) then v_result := v_result || jsonb_build_object('categories', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select id, name, is_archived from public.categories where organization_id = target_organization_id) x), '[]'::jsonb)); end if;
  if 'products' = any(v_needs) then v_result := v_result || jsonb_build_object('products', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select id, category_id, name, sku, barcode, product_type, is_composite, composite_inventory_mode, unit, status, track_inventory, price_minor from public.products where organization_id = target_organization_id and status::text = 'active' and track_inventory) x), '[]'::jsonb)); end if;
  if 'variants' = any(v_needs) then v_result := v_result || jsonb_build_object('variants', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order) from (select id, product_id, name, sku, barcode, sort_order, is_active, price_minor from public.product_variants where organization_id = target_organization_id and is_active) x), '[]'::jsonb)); end if;
  if 'productStoreSettings' = any(v_needs) then v_result := v_result || jsonb_build_object('productStoreSettings', coalesce((select jsonb_agg(to_jsonb(x)) from (select product_id, store_id, is_available, price_override_minor, restock_policy, updated_at from public.product_store_settings where organization_id = target_organization_id and (v_store_filter is null or store_id = any(v_store_filter))) x), '[]'::jsonb)); end if;
  if 'inventoryLevels' = any(v_needs) then v_result := v_result || jsonb_build_object('inventoryLevels', coalesce((select jsonb_agg(to_jsonb(x)) from (select id, store_id, product_id, variant_id, quantity, updated_at from public.inventory_levels where organization_id = target_organization_id and (v_store_filter is null or store_id = any(v_store_filter))) x), '[]'::jsonb)); end if;
  if 'warehouses' = any(v_needs) then v_result := v_result || jsonb_build_object('warehouses', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select id, store_id, code, name from public.supply_chain_warehouses where organization_id = target_organization_id and is_active and (v_store_filter is null or store_id = any(v_store_filter))) x), '[]'::jsonb)); end if;
  if 'replenishmentRules' = any(v_needs) then v_result := v_result || jsonb_build_object('replenishmentRules', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (select id, store_id, product_id, variant_id, preferred_warehouse_id, reorder_point, target_stock, updated_at from public.inventory_replenishment_rules where organization_id = target_organization_id and (v_store_filter is null or store_id = any(v_store_filter))) x), '[]'::jsonb)); end if;
  if 'suppliers' = any(v_needs) then v_result := v_result || jsonb_build_object('suppliers', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select id, name, contact_name, email, phone, address, notes, is_active, lead_time_days from public.suppliers where organization_id = target_organization_id) x), '[]'::jsonb)); end if;
  if 'stockRequests' = any(v_needs) then v_result := v_result || jsonb_build_object('stockRequests', coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at desc) from (select id, request_number, requesting_store_id, source_warehouse_id, status, note, requested_at, approved_at, picked_at, dispatched_at, received_at, updated_at from public.stock_requests where organization_id = target_organization_id and (v_store_filter is null or requesting_store_id = any(v_store_filter)) order by requested_at desc limit 30) x), '[]'::jsonb)); end if;
  if 'stockRequestLines' = any(v_needs) then v_result := v_result || jsonb_build_object('stockRequestLines', coalesce((select jsonb_agg(to_jsonb(x)) from (select line.id, line.stock_request_id, line.product_name_snapshot, line.variant_name_snapshot, line.unit_snapshot, line.requested_quantity, line.approved_quantity, line.picked_quantity, line.dispatched_quantity, line.received_quantity, line.short_quantity from public.stock_request_lines line join public.stock_requests request_row on request_row.id = line.stock_request_id where line.organization_id = target_organization_id and (v_store_filter is null or request_row.requesting_store_id = any(v_store_filter)) order by request_row.requested_at desc limit 1000) x), '[]'::jsonb)); end if;
  if 'stockRequestDiscrepancies' = any(v_needs) then v_result := v_result || jsonb_build_object('stockRequestDiscrepancies', coalesce((select jsonb_agg(to_jsonb(x) order by x.reported_at asc) from (select discrepancy.stock_request_id, discrepancy.stock_request_line_id, discrepancy.short_quantity, discrepancy.note, discrepancy.reported_at from public.stock_request_discrepancies discrepancy join public.stock_requests request_row on request_row.id = discrepancy.stock_request_id where discrepancy.organization_id = target_organization_id and (v_store_filter is null or request_row.requesting_store_id = any(v_store_filter)) order by discrepancy.reported_at asc limit 1000) x), '[]'::jsonb)); end if;
  if 'requestStockTransfers' = any(v_needs) then v_result := v_result || jsonb_build_object('requestStockTransfers', coalesce((select jsonb_agg(to_jsonb(x)) from (select transfer.id, transfer.stock_request_id, transfer.destination_store_id, transfer.status, transfer.transfer_number from public.stock_transfers transfer join public.stock_requests request_row on request_row.id = transfer.stock_request_id where transfer.organization_id = target_organization_id and (v_store_filter is null or request_row.requesting_store_id = any(v_store_filter))) x), '[]'::jsonb)); end if;
  if 'archivedProductCount' = any(v_needs) then v_result := v_result || jsonb_build_object('archivedProductCount', (select count(*)::integer from public.products where organization_id = target_organization_id and status::text = 'archived')); end if;
  if 'openPurchaseOrdersCount' = any(v_needs) then v_result := v_result || jsonb_build_object('openPurchaseOrdersCount', (select count(*)::integer from public.purchase_orders where organization_id = target_organization_id and status::text in ('ordered', 'partially_received') and (v_store_filter is null or store_id = any(v_store_filter)))); end if;

  -- The remaining related records are derived with bounded parent sets, preserving RLS.
  if 'openPurchaseOrders' = any(v_needs) or 'openPurchaseOrderLines' = any(v_needs) then
    v_result := v_result || jsonb_build_object('openPurchaseOrders', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, order_number, supplier_id, store_id, status, expected_at, created_at from public.purchase_orders where organization_id = target_organization_id and status::text in ('ordered', 'partially_received') and (v_store_filter is null or store_id = any(v_store_filter)) order by created_at desc limit 20) x), '[]'::jsonb));
    v_result := v_result || jsonb_build_object('openPurchaseOrderLines', coalesce((select jsonb_agg(to_jsonb(x)) from (select line.purchase_order_id, line.product_id, line.variant_id, line.ordered_quantity, line.received_quantity from public.purchase_order_lines line join public.purchase_orders order_row on order_row.id = line.purchase_order_id where line.organization_id = target_organization_id and order_row.status::text in ('ordered', 'partially_received') and (v_store_filter is null or order_row.store_id = any(v_store_filter)) order by order_row.created_at desc limit 500) x), '[]'::jsonb));
  end if;
  if 'receivableStockTransfers' = any(v_needs) or 'stockTransferLines' = any(v_needs) then
    v_result := v_result || jsonb_build_object('receivableStockTransfers', coalesce((select jsonb_agg(to_jsonb(x)) from (select id, transfer_number, stock_request_id, source_store_id, destination_store_id, status, note from public.stock_transfers where organization_id = target_organization_id and status::text in ('dispatched', 'partially_received') and (v_store_filter is null or source_store_id = any(v_store_filter) or destination_store_id = any(v_store_filter))) x), '[]'::jsonb));
    v_result := v_result || jsonb_build_object('stockTransferLines', coalesce((select jsonb_agg(to_jsonb(x)) from (select line.id, line.stock_transfer_id, line.stock_request_line_id, line.product_id, line.variant_id, line.quantity, line.received_quantity, line.short_quantity from public.stock_transfer_lines line join public.stock_transfers transfer on transfer.id = line.stock_transfer_id where line.organization_id = target_organization_id and transfer.status::text in ('dispatched', 'partially_received') and (v_store_filter is null or transfer.source_store_id = any(v_store_filter) or transfer.destination_store_id = any(v_store_filter))) x), '[]'::jsonb));
  end if;

  return v_result;
end;
$function$;

revoke all on function public.get_inventory_workspace_bundle_v1(uuid, uuid[], text[], timestamptz, timestamptz, text, text, text, integer, integer) from public;
grant execute on function public.get_inventory_workspace_bundle_v1(uuid, uuid[], text[], timestamptz, timestamptz, text, text, text, integer, integer) to tindio_authenticated;

commit;
