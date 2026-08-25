-- New catalog items are created after the first cost backfill. When their first
-- controlled adjustment has no explicit cost, retain their catalog cost basis.
begin;

create or replace function private.apply_inventory_change_v2(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid,
  target_quantity_delta numeric, target_movement_type text, target_actor_employee_id uuid,
  target_reason text, target_source_type text, target_source_id uuid,
  target_unit_cost_minor bigint default null, target_reason_code text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare current_quantity numeric(14,3); next_quantity numeric(14,3); current_average_cost bigint; catalog_unit_cost bigint; resolved_unit_cost bigint; next_average_cost bigint;
begin
  if target_quantity_delta = 0 or target_reason is null or char_length(btrim(target_reason)) not between 2 and 500 then
    raise exception 'Inventory quantity and reason are required.' using errcode = '23514';
  end if;
  if target_source_id is not null and target_source_type is null then
    raise exception 'Inventory sources require a source type.' using errcode = '23514';
  end if;
  select level.quantity, level.average_cost_minor into current_quantity, current_average_cost
  from public.inventory_levels level
  where level.organization_id = target_organization_id and level.store_id = target_store_id
    and level.product_id = target_product_id and level.variant_id is not distinct from target_variant_id
  for update;
  if not found then raise exception 'The stock projection is not initialized for this item and store.' using errcode = '23514'; end if;
  select coalesce(variant.cost_minor, product.cost_minor, 0) into catalog_unit_cost
  from public.products product
  left join public.product_variants variant
    on variant.id is not distinct from target_variant_id
   and variant.product_id = product.id
   and variant.organization_id = product.organization_id
  where product.id = target_product_id and product.organization_id = target_organization_id;
  next_quantity := current_quantity + target_quantity_delta;
  resolved_unit_cost := greatest(coalesce(target_unit_cost_minor, nullif(current_average_cost, 0), catalog_unit_cost, 0), 0);
  next_average_cost := current_average_cost;
  if target_quantity_delta > 0 and target_movement_type in ('RECEIPT', 'TRANSFER_IN', 'PRODUCTION') and next_quantity > 0 then
    next_average_cost := round(((current_quantity * current_average_cost) + (target_quantity_delta * resolved_unit_cost)) / next_quantity)::bigint;
  elsif target_quantity_delta > 0 and current_quantity = 0 and current_average_cost = 0 then
    next_average_cost := resolved_unit_cost;
  end if;
  update public.inventory_levels
  set quantity = next_quantity, average_cost_minor = next_average_cost, updated_at = now()
  where organization_id = target_organization_id and store_id = target_store_id
    and product_id = target_product_id and variant_id is not distinct from target_variant_id;
  insert into public.inventory_movements (
    organization_id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after,
    movement_type, actor_employee_id, reason, source_type, source_id, unit_cost_minor, value_delta_minor, reason_code
  ) values (
    target_organization_id, target_store_id, target_product_id, target_variant_id, target_quantity_delta,
    current_quantity, next_quantity, target_movement_type, target_actor_employee_id, btrim(target_reason),
    case when target_source_id is null then null else target_source_type end,
    target_source_id, resolved_unit_cost, round(target_quantity_delta * resolved_unit_cost)::bigint, target_reason_code
  );
end;
$$;

grant execute on function private.apply_inventory_change_v2(uuid,uuid,uuid,uuid,numeric,text,uuid,text,text,uuid,bigint,text) to authenticated;

commit;
