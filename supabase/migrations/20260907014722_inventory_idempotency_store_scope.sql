-- Phase 9: make every currently supported inventory posting route replay-safe
-- and align document reads with the same store scope used by inventory levels.
begin;

alter table public.supplier_returns add column if not exists operation_id uuid;
alter table public.production_runs add column if not exists operation_id uuid;

create unique index if not exists supplier_returns_organization_operation_id_unique
  on public.supplier_returns (organization_id, operation_id)
  where operation_id is not null;

create unique index if not exists production_runs_organization_operation_id_unique
  on public.production_runs (organization_id, operation_id)
  where operation_id is not null;

create or replace function private.return_to_supplier(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  return_id uuid;
  existing_return public.supplier_returns%rowtype;
  line jsonb;
  stock_level public.inventory_levels%rowtype;
  line_quantity numeric(14,3);
  normalized_note text;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'An operation ID is required for a supplier return.' using errcode = '23514';
  end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A supplier return needs one to 100 items.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = target_supplier_id
      and supplier.organization_id = target_organization_id
      and supplier.is_active
  ) then
    raise exception 'Choose an active supplier.' using errcode = '23514';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  select * into existing_return
  from public.supplier_returns supplier_return
  where supplier_return.organization_id = target_organization_id
    and supplier_return.operation_id = target_operation_id;

  if found then
    if existing_return.store_id is distinct from target_store_id
      or existing_return.supplier_id is distinct from target_supplier_id
      or existing_return.note is distinct from normalized_note then
      raise exception 'This operation ID was already used for a different supplier return.' using errcode = '23514';
    end if;
    return existing_return.id;
  end if;

  insert into public.supplier_returns (
    organization_id, supplier_id, store_id, returned_by_employee_id, note, operation_id
  ) values (
    target_organization_id, target_supplier_id, target_store_id, actor_id, normalized_note, target_operation_id
  ) on conflict (organization_id, operation_id) where operation_id is not null do nothing
  returning id into return_id;

  if return_id is null then
    select * into existing_return
    from public.supplier_returns supplier_return
    where supplier_return.organization_id = target_organization_id
      and supplier_return.operation_id = target_operation_id;
    if existing_return.store_id is distinct from target_store_id
      or existing_return.supplier_id is distinct from target_supplier_id
      or existing_return.note is distinct from normalized_note then
      raise exception 'This operation ID was already used for a different supplier return.' using errcode = '23514';
    end if;
    return existing_return.id;
  end if;

  for line in
    select value
    from jsonb_array_elements(target_lines)
    order by value->>'product_id', coalesce(value->>'variant_id', '')
  loop
    if coalesce(line->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(line->>'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or (line->>'quantity')::numeric <= 0 then
      raise exception 'Supplier-return lines must include valid items and quantities.' using errcode = '23514';
    end if;

    line_quantity := (line->>'quantity')::numeric(14,3);
    select * into stock_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = (line->>'product_id')::uuid
      and level.variant_id is not distinct from nullif(line->>'variant_id', '')::uuid
    for update;

    if stock_level.id is null or stock_level.quantity < line_quantity then
      raise exception 'Stock is insufficient for this supplier return.' using errcode = '23514';
    end if;

    insert into public.supplier_return_lines (
      organization_id, supplier_return_id, product_id, variant_id, quantity, unit_cost_minor
    ) values (
      target_organization_id, return_id, stock_level.product_id, stock_level.variant_id,
      line_quantity, stock_level.average_cost_minor
    );
    perform private.apply_inventory_change_v2(
      target_organization_id, target_store_id, stock_level.product_id, stock_level.variant_id,
      -line_quantity, 'SUPPLIER_RETURN', actor_id, 'Returned to supplier', 'supplier_return',
      return_id, stock_level.average_cost_minor
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id, 'SUPPLIER_RETURN_CREATED', 'inventory.manage', actor_id, null,
    target_store_id, null, null, null, target_note,
    jsonb_build_object('supplier_return_id', return_id, 'supplier_id', target_supplier_id, 'operation_id', target_operation_id)
  );
  return return_id;
end;
$$;

create or replace function public.return_to_supplier(
  target_organization_id uuid,
  target_store_id uuid,
  target_supplier_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.return_to_supplier(
    target_organization_id, target_store_id, target_supplier_id, target_lines, target_note, target_operation_id
  );
$$;

create or replace function private.produce_composite(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_quantity numeric,
  target_note text,
  target_operation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  run_id uuid;
  existing_run public.production_runs%rowtype;
  component record;
  component_level public.inventory_levels%rowtype;
  output_level public.inventory_levels%rowtype;
  component_quantity numeric(14,3);
  total_cost numeric := 0;
  output_unit_cost bigint;
  normalized_note text;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'An operation ID is required for production.' using errcode = '23514';
  end if;
  if target_quantity is null or target_quantity <= 0 or target_quantity <> round(target_quantity, 3) then
    raise exception 'Production quantity must be positive and use at most three decimals.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products product
    where product.id = target_product_id
      and product.organization_id = target_organization_id
      and product.is_composite
      and product.track_inventory
      and product.status = 'active'
  ) then
    raise exception 'Choose an active composite inventory product.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.product_components component
    where component.organization_id = target_organization_id
      and component.product_id = target_product_id
  ) then
    raise exception 'This composite product needs at least one component recipe item.' using errcode = '23514';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  select * into existing_run
  from public.production_runs production_run
  where production_run.organization_id = target_organization_id
    and production_run.operation_id = target_operation_id;

  if found then
    if existing_run.store_id is distinct from target_store_id
      or existing_run.product_id is distinct from target_product_id
      or existing_run.quantity_produced is distinct from target_quantity
      or existing_run.note is distinct from normalized_note then
      raise exception 'This operation ID was already used for a different production run.' using errcode = '23514';
    end if;
    return existing_run.id;
  end if;

  -- Lock every participating projection in a stable order before changing stock.
  perform 1
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and (
      level.product_id = target_product_id
      or exists (
        select 1 from public.product_components recipe
        where recipe.organization_id = target_organization_id
          and recipe.product_id = target_product_id
          and recipe.component_product_id = level.product_id
          and recipe.component_variant_id is not distinct from level.variant_id
      )
    )
  order by level.product_id, level.variant_id
  for update;

  select * into output_level
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and level.product_id = target_product_id
    and level.variant_id is null
  for update;
  if output_level.id is null then
    raise exception 'The composite output stock projection is not initialized.' using errcode = '23514';
  end if;

  insert into public.production_runs (
    organization_id, store_id, product_id, quantity_produced, produced_by_employee_id, note, operation_id
  ) values (
    target_organization_id, target_store_id, target_product_id, target_quantity, actor_id, normalized_note, target_operation_id
  ) on conflict (organization_id, operation_id) where operation_id is not null do nothing
  returning id into run_id;

  if run_id is null then
    select * into existing_run
    from public.production_runs production_run
    where production_run.organization_id = target_organization_id
      and production_run.operation_id = target_operation_id;
    if existing_run.store_id is distinct from target_store_id
      or existing_run.product_id is distinct from target_product_id
      or existing_run.quantity_produced is distinct from target_quantity
      or existing_run.note is distinct from normalized_note then
      raise exception 'This operation ID was already used for a different production run.' using errcode = '23514';
    end if;
    return existing_run.id;
  end if;

  for component in
    select * from public.product_components item
    where item.organization_id = target_organization_id
      and item.product_id = target_product_id
    order by item.component_product_id, item.component_variant_id
  loop
    component_quantity := component.quantity_per_composite * target_quantity;
    select * into component_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = component.component_product_id
      and level.variant_id is not distinct from component.component_variant_id
    for update;
    if component_level.id is null or component_level.quantity < component_quantity then
      raise exception 'One production component has insufficient stock.' using errcode = '23514';
    end if;
    total_cost := total_cost + component_quantity * component_level.average_cost_minor;
    perform private.apply_inventory_change_v2(
      target_organization_id, target_store_id, component_level.product_id, component_level.variant_id,
      -component_quantity, 'PRODUCTION', actor_id, 'Consumed by production', 'production_run',
      run_id, component_level.average_cost_minor
    );
  end loop;

  output_unit_cost := round(total_cost / target_quantity)::bigint;
  perform private.apply_inventory_change_v2(
    target_organization_id, target_store_id, target_product_id, null, target_quantity,
    'PRODUCTION', actor_id, 'Produced composite stock', 'production_run', run_id, output_unit_cost
  );
  perform private.write_audit_log(
    target_organization_id, 'PRODUCTION_COMPLETED', 'inventory.manage', actor_id, null,
    target_store_id, null, null, null, target_note,
    jsonb_build_object('production_run_id', run_id, 'product_id', target_product_id, 'quantity', target_quantity, 'unit_cost_minor', output_unit_cost, 'operation_id', target_operation_id)
  );
  return run_id;
end;
$$;

create or replace function public.produce_composite(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_quantity numeric,
  target_note text,
  target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.produce_composite(
    target_organization_id, target_store_id, target_product_id, target_quantity, target_note, target_operation_id
  );
$$;

-- Keep legacy overloads for existing historical references, but revoke their
-- direct entry points so every newly posted document has replay protection.
revoke execute on function public.return_to_supplier(uuid, uuid, uuid, jsonb, text) from authenticated;
revoke execute on function private.return_to_supplier(uuid, uuid, uuid, jsonb, text) from authenticated;
revoke execute on function public.produce_composite(uuid, uuid, uuid, numeric, text) from authenticated;
revoke execute on function private.produce_composite(uuid, uuid, uuid, numeric, text) from authenticated;

revoke all on function private.return_to_supplier(uuid, uuid, uuid, jsonb, text, uuid) from public, anon, service_role;
revoke all on function private.produce_composite(uuid, uuid, uuid, numeric, text, uuid) from public, anon, service_role;
revoke all on function public.return_to_supplier(uuid, uuid, uuid, jsonb, text, uuid) from public, anon, service_role;
revoke all on function public.produce_composite(uuid, uuid, uuid, numeric, text, uuid) from public, anon, service_role;
grant execute on function private.return_to_supplier(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function private.produce_composite(uuid, uuid, uuid, numeric, text, uuid) to authenticated;
grant execute on function public.return_to_supplier(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.produce_composite(uuid, uuid, uuid, numeric, text, uuid) to authenticated;

drop policy if exists supplier_returns_select_manager on public.supplier_returns;
create policy supplier_returns_select_authorized_scope on public.supplier_returns
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists supplier_return_lines_select_manager on public.supplier_return_lines;
create policy supplier_return_lines_select_authorized_scope on public.supplier_return_lines
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and exists (
      select 1
      from public.supplier_returns supplier_return
      where supplier_return.id = supplier_return_lines.supplier_return_id
        and supplier_return.organization_id = supplier_return_lines.organization_id
        and (select private.has_store_read_scope(supplier_return.organization_id, supplier_return.store_id))
    )
  );

drop policy if exists production_runs_select_manager on public.production_runs;
create policy production_runs_select_authorized_scope on public.production_runs
  for select to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

commit;
