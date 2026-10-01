begin;

create or replace function public.get_inventory_purchasing_bundle_v1(
  target_organization_id uuid,
  target_store_ids uuid[] default null,
  requested_needs text[] default array[]::text[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_needs text[] := coalesce(requested_needs, array[]::text[]);
  v_result jsonb := jsonb_build_object('openPurchaseOrdersCount', 0);
  v_purchase_order_ids uuid[] := array[]::uuid[];
  v_goods_receipt_ids uuid[] := array[]::uuid[];
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required' using errcode = '22004';
  end if;

  /*
   * SECURITY INVOKER is mandatory. Canonical grants and table RLS remain
   * authoritative; organization and store parameters only narrow scope.
   */
  if 'stores' = any(v_needs) then
    v_result := v_result || jsonb_build_object('stores', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at) from (
      select store.id, store.name, store.is_active, store.created_at from public.stores store
      where store.organization_id = target_organization_id and store.is_active
        and (target_store_ids is null or store.id = any(target_store_ids))
    ) row_data), '[]'::jsonb));
  end if;
  if 'products' = any(v_needs) then
    v_result := v_result || jsonb_build_object('products', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select product.id, product.name, product.sku, product.barcode, product.product_type, product.unit, product.status, product.track_inventory
      from public.products product where product.organization_id = target_organization_id and product.status::text = 'active' and product.track_inventory
    ) row_data), '[]'::jsonb));
  end if;
  if 'variants' = any(v_needs) then
    v_result := v_result || jsonb_build_object('variants', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order) from (
      select variant.id, variant.product_id, variant.name, variant.sku, variant.barcode, variant.sort_order, variant.is_active
      from public.product_variants variant where variant.organization_id = target_organization_id and variant.is_active
    ) row_data), '[]'::jsonb));
  end if;
  if 'productUnits' = any(v_needs) then
    v_result := v_result || jsonb_build_object('productUnits', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.is_purchase_unit desc, row_data.is_base desc, row_data.unit_name) from (
      select unit.product_id, unit.unit_code, unit.unit_name, unit.factor_to_base, unit.is_base, unit.is_purchase_unit
      from public.product_units unit where unit.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'productStoreSettings' = any(v_needs) then
    v_result := v_result || jsonb_build_object('productStoreSettings', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select setting.product_id, setting.store_id, setting.is_available
      from public.product_store_settings setting where setting.organization_id = target_organization_id
        and (target_store_ids is null or setting.store_id = any(target_store_ids))
    ) row_data), '[]'::jsonb));
  end if;
  if 'suppliers' = any(v_needs) then
    v_result := v_result || jsonb_build_object('suppliers', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select supplier.id, supplier.name, supplier.contact_name, supplier.email, supplier.phone, supplier.address, supplier.notes, supplier.is_active, supplier.lead_time_days
      from public.suppliers supplier where supplier.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;

  if 'purchaseOrders' = any(v_needs) or 'purchaseOrderLines' = any(v_needs) or 'goodsReceipts' = any(v_needs) or 'goodsReceiptLines' = any(v_needs) then
    select coalesce(array_agg(selected.id order by selected.created_at desc), array[]::uuid[]) into v_purchase_order_ids from (
      select purchase_order.id, purchase_order.created_at from public.purchase_orders purchase_order
      where purchase_order.organization_id = target_organization_id
        and (target_store_ids is null or purchase_order.store_id = any(target_store_ids))
      order by purchase_order.created_at desc limit 30
    ) selected;
  end if;
  if 'purchaseOrders' = any(v_needs) then
    v_result := v_result || jsonb_build_object('purchaseOrders', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc) from (
      select purchase_order.id, purchase_order.supplier_id, purchase_order.store_id, purchase_order.order_number, purchase_order.status, purchase_order.expected_at, purchase_order.created_at
      from public.purchase_orders purchase_order where purchase_order.id = any(v_purchase_order_ids)
    ) row_data), '[]'::jsonb));
  end if;
  if 'purchaseOrderLines' = any(v_needs) then
    v_result := v_result || jsonb_build_object('purchaseOrderLines', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select line.id, line.purchase_order_id, line.product_id, line.variant_id, line.product_name_snapshot, line.variant_name_snapshot, line.unit_snapshot, line.purchase_unit_code_snapshot, line.purchase_unit_factor_to_base, line.ordered_quantity, line.received_quantity
      from public.purchase_order_lines line where line.organization_id = target_organization_id and line.purchase_order_id = any(v_purchase_order_ids)
    ) row_data), '[]'::jsonb));
  end if;
  if 'goodsReceipts' = any(v_needs) or 'goodsReceiptLines' = any(v_needs) then
    select coalesce(array_agg(selected.id order by selected.received_at desc), array[]::uuid[]) into v_goods_receipt_ids from (
      select receipt.id, receipt.received_at from public.goods_receipts receipt
      where receipt.organization_id = target_organization_id and receipt.purchase_order_id = any(v_purchase_order_ids)
      order by receipt.received_at desc limit 50
    ) selected;
  end if;
  if 'goodsReceipts' = any(v_needs) then
    v_result := v_result || jsonb_build_object('goodsReceipts', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.received_at desc) from (
      select receipt.id, receipt.receipt_number, receipt.purchase_order_id, receipt.store_id, receipt.note, receipt.received_at
      from public.goods_receipts receipt where receipt.id = any(v_goods_receipt_ids)
    ) row_data), '[]'::jsonb));
  end if;
  if 'goodsReceiptLines' = any(v_needs) then
    v_result := v_result || jsonb_build_object('goodsReceiptLines', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select line.goods_receipt_id, line.purchase_order_line_id, line.quantity_received
      from public.goods_receipt_lines line where line.organization_id = target_organization_id and line.goods_receipt_id = any(v_goods_receipt_ids)
    ) row_data), '[]'::jsonb));
  end if;
  if 'openPurchaseOrdersCount' = any(v_needs) then
    v_result := v_result || jsonb_build_object('openPurchaseOrdersCount', (
      select count(*)::integer from public.purchase_orders purchase_order
      where purchase_order.organization_id = target_organization_id
        and purchase_order.status::text in ('ordered', 'partially_received')
        and (target_store_ids is null or purchase_order.store_id = any(target_store_ids))
    ));
  end if;
  return v_result;
end;
$function$;

revoke all on function public.get_inventory_purchasing_bundle_v1(uuid, uuid[], text[]) from public;
grant execute on function public.get_inventory_purchasing_bundle_v1(uuid, uuid[], text[]) to tindio_authenticated;
comment on function public.get_inventory_purchasing_bundle_v1(uuid, uuid[], text[])
  is 'TINDIO R5 bounded Purchasing read model. SECURITY INVOKER preserves canonical grants and RLS while consolidating Purchasing read round-trips.';

commit;
