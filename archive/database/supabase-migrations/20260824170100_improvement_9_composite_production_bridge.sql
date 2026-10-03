-- TINDIO represents composites as simple checkout products flagged by
-- is_composite. Align the new production routine with that established model.
begin;

create or replace function private.produce_composite(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_quantity numeric, target_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; run_id uuid; component record; component_level public.inventory_levels%rowtype; output_level public.inventory_levels%rowtype; component_quantity numeric(14,3); total_cost numeric := 0; output_unit_cost bigint;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_quantity is null or target_quantity <= 0 or target_quantity <> round(target_quantity, 3) then raise exception 'Production quantity must be positive and use at most three decimals.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.products product where product.id = target_product_id and product.organization_id = target_organization_id and product.is_composite and product.track_inventory and product.status = 'active') then raise exception 'Choose an active composite inventory product.' using errcode = '23514'; end if;
  if not exists (select 1 from public.product_components component where component.organization_id = target_organization_id and component.product_id = target_product_id) then raise exception 'This composite product needs at least one component recipe item.' using errcode = '23514'; end if;

  -- Take all participating projections in a stable order to keep concurrent
  -- production runs from acquiring locks in opposing sequences.
  perform 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and (level.product_id = target_product_id or exists (select 1 from public.product_components component where component.organization_id = target_organization_id and component.product_id = target_product_id and component.component_product_id = level.product_id and component.component_variant_id is not distinct from level.variant_id)) order by level.product_id, level.variant_id for update;
  select * into output_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = target_product_id and level.variant_id is null for update;
  if output_level.id is null then raise exception 'The composite output stock projection is not initialized.' using errcode = '23514'; end if;
  insert into public.production_runs (organization_id, store_id, product_id, quantity_produced, produced_by_employee_id, note) values (target_organization_id, target_store_id, target_product_id, target_quantity, actor_id, nullif(btrim(target_note), '')) returning id into run_id;
  for component in select * from public.product_components item where item.organization_id = target_organization_id and item.product_id = target_product_id order by item.component_product_id, item.component_variant_id loop
    component_quantity := component.quantity_per_composite * target_quantity;
    select * into component_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = component.component_product_id and level.variant_id is not distinct from component.component_variant_id for update;
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

revoke execute on function private.produce_composite(uuid,uuid,uuid,numeric,text) from public, anon, service_role;
grant execute on function private.produce_composite(uuid,uuid,uuid,numeric,text) to authenticated;

commit;
