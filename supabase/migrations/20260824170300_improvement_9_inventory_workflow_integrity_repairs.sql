-- Repair integration details identified by the Phase 9 end-to-end database
-- workflow test. Both changes preserve the append-only ledger contract.
begin;

create or replace function private.apply_inventory_change_v2(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid,
  target_quantity_delta numeric, target_movement_type text, target_actor_employee_id uuid,
  target_reason text, target_source_type text, target_source_id uuid,
  target_unit_cost_minor bigint default null, target_reason_code text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare current_quantity numeric(14,3); next_quantity numeric(14,3); current_average_cost bigint; resolved_unit_cost bigint; next_average_cost bigint;
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
  next_quantity := current_quantity + target_quantity_delta;
  resolved_unit_cost := greatest(coalesce(target_unit_cost_minor, current_average_cost, 0), 0);
  next_average_cost := current_average_cost;
  if target_quantity_delta > 0 and target_movement_type in ('RECEIPT', 'TRANSFER_IN', 'PRODUCTION') and next_quantity > 0 then
    next_average_cost := round(((current_quantity * current_average_cost) + (target_quantity_delta * resolved_unit_cost)) / next_quantity)::bigint;
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

create or replace function private.produce_composite(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_quantity numeric, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; run_id uuid; recipe_item record; component_level public.inventory_levels%rowtype; output_level public.inventory_levels%rowtype; component_quantity numeric(14,3); total_cost numeric := 0; output_unit_cost bigint;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_quantity is null or target_quantity <= 0 or target_quantity <> round(target_quantity, 3) then raise exception 'Production quantity must be positive and use at most three decimals.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.products product where product.id = target_product_id and product.organization_id = target_organization_id and product.is_composite and product.track_inventory and product.status = 'active') then raise exception 'Choose an active composite inventory product.' using errcode = '23514'; end if;
  if not exists (select 1 from public.product_components recipe where recipe.organization_id = target_organization_id and recipe.product_id = target_product_id) then raise exception 'This composite product needs at least one component recipe item.' using errcode = '23514'; end if;
  perform 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and (level.product_id = target_product_id or exists (select 1 from public.product_components recipe where recipe.organization_id = target_organization_id and recipe.product_id = target_product_id and recipe.component_product_id = level.product_id and recipe.component_variant_id is not distinct from level.variant_id)) order by level.product_id, level.variant_id for update;
  select * into output_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = target_product_id and level.variant_id is null for update;
  if output_level.id is null then raise exception 'The composite output stock projection is not initialized.' using errcode = '23514'; end if;
  insert into public.production_runs (organization_id, store_id, product_id, quantity_produced, produced_by_employee_id, note)
  values (target_organization_id, target_store_id, target_product_id, target_quantity, actor_id, nullif(btrim(target_note), '')) returning id into run_id;
  for recipe_item in select * from public.product_components recipe where recipe.organization_id = target_organization_id and recipe.product_id = target_product_id order by recipe.component_product_id, recipe.component_variant_id loop
    component_quantity := recipe_item.quantity_per_composite * target_quantity;
    select * into component_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = recipe_item.component_product_id and level.variant_id is not distinct from recipe_item.component_variant_id for update;
    if component_level.id is null or component_level.quantity < component_quantity then raise exception 'One production component has insufficient stock.' using errcode = '23514'; end if;
    total_cost := total_cost + component_quantity * component_level.average_cost_minor;
    perform private.apply_inventory_change_v2(target_organization_id, target_store_id, component_level.product_id, component_level.variant_id, -component_quantity, 'PRODUCTION', actor_id, 'Consumed by production', 'production_run', run_id, component_level.average_cost_minor);
  end loop;
  output_unit_cost := round(total_cost / target_quantity)::bigint;
  perform private.apply_inventory_change_v2(target_organization_id, target_store_id, target_product_id, null, target_quantity, 'PRODUCTION', actor_id, 'Produced composite stock', 'production_run', run_id, output_unit_cost);
  perform private.write_audit_log(target_organization_id, 'PRODUCTION_COMPLETED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, target_note, jsonb_build_object('production_run_id', run_id, 'product_id', target_product_id, 'quantity', target_quantity, 'unit_cost_minor', output_unit_cost));
  return run_id;
end;
$$;

grant execute on function private.apply_inventory_change_v2(uuid,uuid,uuid,uuid,numeric,text,uuid,text,text,uuid,bigint,text), private.produce_composite(uuid,uuid,uuid,numeric,text) to authenticated;

commit;
