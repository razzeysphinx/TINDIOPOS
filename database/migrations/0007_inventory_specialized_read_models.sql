begin;

create or replace function public.get_inventory_valuation_reference_bundle_v1(target_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $function$
  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select product.id, product.name, product.unit, product.status, product.product_type, product.price_minor
      from public.products product
      where product.organization_id = target_organization_id and product.track_inventory
    ) row_data), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.product_id, row_data.name) from (
      select variant.id, variant.product_id, variant.name, variant.price_minor, variant.is_active
      from public.product_variants variant where variant.organization_id = target_organization_id
    ) row_data), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select store.id, store.name from public.stores store where store.organization_id = target_organization_id
    ) row_data), '[]'::jsonb)
  );
$function$;

revoke all on function public.get_inventory_valuation_reference_bundle_v1(uuid) from public;
grant execute on function public.get_inventory_valuation_reference_bundle_v1(uuid) to tindio_authenticated;

create or replace function public.get_inventory_activity_reference_bundle_v1(
  target_organization_id uuid,
  target_store_id uuid default null,
  target_product_id uuid default null,
  target_variant_id uuid default null,
  requested_movement_ids uuid[] default null,
  requested_limit integer default 50,
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
  v_limit integer := least(greatest(coalesce(requested_limit, 50), 1), 100);
  v_movement_ids uuid[] := array[]::uuid[];
  v_result jsonb := '{}'::jsonb;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required' using errcode = '22004';
  end if;

  if target_store_id is not null and target_product_id is not null then
    select coalesce(array_agg(selected.id order by selected.created_at desc, selected.id desc), array[]::uuid[])
      into v_movement_ids
    from (
      select movement.id, movement.created_at
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = target_store_id
        and movement.product_id = target_product_id
        and ((target_variant_id is null and movement.variant_id is null) or movement.variant_id = target_variant_id)
      order by movement.created_at desc, movement.id desc
      limit v_limit
    ) selected;
  else
    v_movement_ids := coalesce(requested_movement_ids, array[]::uuid[]);
  end if;

  if 'movements' = any(v_needs) then
    v_result := v_result || jsonb_build_object('movements', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc, row_data.id desc) from (
      select movement.id, movement.store_id, movement.product_id, movement.variant_id, movement.quantity_delta,
        movement.quantity_before, movement.quantity_after, movement.movement_type, movement.actor_employee_id,
        movement.reason, movement.reason_code, movement.source_type, movement.source_id, movement.unit_snapshot,
        movement.created_at
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids)
    ) row_data), '[]'::jsonb));
  end if;
  if 'employees' = any(v_needs) then
    v_result := v_result || jsonb_build_object('employees', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct employee.id, employee.profile_id, employee.employee_number
      from public.employees employee join public.inventory_movements movement on movement.actor_employee_id = employee.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and employee.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'profiles' = any(v_needs) then
    v_result := v_result || jsonb_build_object('profiles', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct profile.id, profile.full_name
      from public.profiles profile join public.employees employee on employee.profile_id = profile.id
      join public.inventory_movements movement on movement.actor_employee_id = employee.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and employee.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'refunds' = any(v_needs) then
    v_result := v_result || jsonb_build_object('refunds', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct refund.id, refund.sale_id from public.refunds refund join public.inventory_movements movement
        on movement.source_type::text = 'refund' and movement.source_id = refund.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and refund.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'receipts' = any(v_needs) then
    v_result := v_result || jsonb_build_object('receipts', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct receipt.id, receipt.sale_id, receipt.receipt_number from public.receipts receipt
      where receipt.organization_id = target_organization_id and (exists (
        select 1 from public.inventory_movements movement
        where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids)
          and movement.source_type::text in ('sale', 'composite_sale') and movement.source_id = receipt.sale_id
      ) or exists (
        select 1 from public.inventory_movements movement join public.refunds refund on movement.source_type::text = 'refund' and movement.source_id = refund.id
        where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids)
          and refund.organization_id = target_organization_id and refund.sale_id = receipt.sale_id
      ))
    ) row_data), '[]'::jsonb));
  end if;
  if 'adjustments' = any(v_needs) then
    v_result := v_result || jsonb_build_object('adjustments', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct adjustment.id, adjustment.adjustment_number from public.inventory_adjustments adjustment join public.inventory_movements movement
        on movement.source_type::text = 'inventory_adjustment' and movement.source_id = adjustment.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and adjustment.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'counts' = any(v_needs) then
    v_result := v_result || jsonb_build_object('counts', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct inventory_count.id, inventory_count.count_number from public.inventory_counts inventory_count join public.inventory_movements movement
        on movement.source_type::text = 'inventory_count' and movement.source_id = inventory_count.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and inventory_count.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'transfers' = any(v_needs) then
    v_result := v_result || jsonb_build_object('transfers', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct transfer.id, transfer.transfer_number from public.stock_transfers transfer join public.inventory_movements movement
        on movement.source_type::text = 'stock_transfer' and movement.source_id = transfer.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and transfer.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'supplierReturns' = any(v_needs) then
    v_result := v_result || jsonb_build_object('supplierReturns', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct supplier_return.id from public.supplier_returns supplier_return join public.inventory_movements movement
        on movement.source_type::text = 'supplier_return' and movement.source_id = supplier_return.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and supplier_return.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  if 'productionRuns' = any(v_needs) then
    v_result := v_result || jsonb_build_object('productionRuns', coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select distinct production_run.id from public.production_runs production_run join public.inventory_movements movement
        on movement.source_type::text = 'production_run' and movement.source_id = production_run.id
      where movement.organization_id = target_organization_id and movement.id = any(v_movement_ids) and production_run.organization_id = target_organization_id
    ) row_data), '[]'::jsonb));
  end if;
  return v_result;
end;
$function$;

revoke all on function public.get_inventory_activity_reference_bundle_v1(uuid, uuid, uuid, uuid, uuid[], integer, text[]) from public;
grant execute on function public.get_inventory_activity_reference_bundle_v1(uuid, uuid, uuid, uuid, uuid[], integer, text[]) to tindio_authenticated;

commit;
