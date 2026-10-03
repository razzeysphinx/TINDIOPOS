-- Phase 11: valuation must distinguish an explicit zero cost from an
-- unverified cost. Existing financial history is retained; ambiguous
-- historical zeroes are deliberately marked for review rather than silently
-- counted as zero-value inventory.
begin;

alter table public.inventory_levels
  add column if not exists cost_is_known boolean not null default false;

alter table public.inventory_movements
  add column if not exists cost_is_known boolean not null default false;

alter table public.stock_transfer_lines
  add column if not exists unit_cost_is_known boolean not null default false;

alter table public.production_runs
  add column if not exists cost_is_known boolean not null default false;

-- Prior migrations stored zero as the required numeric default, so they did
-- not preserve whether that zero was intentionally supplied. Positive
-- historical costs are provable; ambiguous zeroes remain review-required.
update public.inventory_levels
set cost_is_known = average_cost_minor > 0;

update public.inventory_movements
set cost_is_known = unit_cost_minor > 0;

update public.stock_transfer_lines
set unit_cost_is_known = unit_cost_minor > 0;

create or replace function private.capture_stock_transfer_line_cost_truth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_cost_is_known boolean;
begin
  select level.cost_is_known
  into source_cost_is_known
  from public.stock_transfers transfer
  join public.inventory_levels level
    on level.organization_id = transfer.organization_id
   and level.store_id = transfer.source_store_id
   and level.product_id = new.product_id
   and level.variant_id is not distinct from new.variant_id
  where transfer.id = new.stock_transfer_id
    and transfer.organization_id = new.organization_id;

  new.unit_cost_is_known := coalesce(source_cost_is_known, false);
  return new;
end;
$$;

revoke execute on function private.capture_stock_transfer_line_cost_truth()
from public, anon, authenticated, service_role;

drop trigger if exists stock_transfer_lines_capture_cost_truth on public.stock_transfer_lines;
create trigger stock_transfer_lines_capture_cost_truth
before insert on public.stock_transfer_lines
for each row execute function private.capture_stock_transfer_line_cost_truth();

create or replace function private.apply_inventory_change_v2(
  target_organization_id uuid, target_store_id uuid, target_product_id uuid, target_variant_id uuid,
  target_quantity_delta numeric, target_movement_type text, target_actor_employee_id uuid,
  target_reason text, target_source_type text, target_source_id uuid,
  target_unit_cost_minor bigint default null, target_reason_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_quantity numeric(14,3);
  next_quantity numeric(14,3);
  current_average_cost bigint;
  current_cost_is_known boolean;
  catalog_unit_cost bigint;
  resolved_unit_cost bigint;
  next_average_cost bigint;
  incoming_cost_is_known boolean := false;
  next_cost_is_known boolean;
  movement_cost_is_known boolean;
begin
  if target_quantity_delta = 0
    or target_reason is null
    or char_length(btrim(target_reason)) not between 2 and 500 then
    raise exception 'Inventory quantity and reason are required.' using errcode = '23514';
  end if;

  if target_source_id is not null and target_source_type is null then
    raise exception 'Inventory sources require a source type.' using errcode = '23514';
  end if;

  select level.quantity, level.average_cost_minor, level.cost_is_known
  into current_quantity, current_average_cost, current_cost_is_known
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and level.product_id = target_product_id
    and level.variant_id is not distinct from target_variant_id
  for update;

  if not found then
    raise exception 'The stock projection is not initialized for this item and store.' using errcode = '23514';
  end if;

  select coalesce(variant.cost_minor, product.cost_minor, 0)
  into catalog_unit_cost
  from public.products product
  left join public.product_variants variant
    on variant.id is not distinct from target_variant_id
   and variant.product_id = product.id
   and variant.organization_id = product.organization_id
  where product.id = target_product_id
    and product.organization_id = target_organization_id;

  next_quantity := current_quantity + target_quantity_delta;
  resolved_unit_cost := greatest(
    coalesce(target_unit_cost_minor, nullif(current_average_cost, 0), catalog_unit_cost, 0),
    0
  );
  next_average_cost := current_average_cost;
  next_cost_is_known := current_cost_is_known;

  if target_quantity_delta > 0 then
    if target_movement_type = 'TRANSFER_IN'
      and target_source_type = 'stock_transfer_receipt'
      and target_source_id is not null then
      select coalesce(transfer_line.unit_cost_is_known, false)
      into incoming_cost_is_known
      from public.stock_transfer_receipt_lines receipt_line
      join public.stock_transfer_lines transfer_line
        on transfer_line.id = receipt_line.stock_transfer_line_id
       and transfer_line.organization_id = receipt_line.organization_id
      where receipt_line.organization_id = target_organization_id
        and receipt_line.stock_transfer_receipt_id = target_source_id
        and transfer_line.product_id = target_product_id
        and transfer_line.variant_id is not distinct from target_variant_id
      limit 1;
    elsif target_movement_type = 'PRODUCTION'
      and target_source_type = 'production_run'
      and target_source_id is not null then
      select coalesce(production_run.cost_is_known, false)
      into incoming_cost_is_known
      from public.production_runs production_run
      where production_run.id = target_source_id
        and production_run.organization_id = target_organization_id;
    elsif target_unit_cost_minor is not null then
      -- A purchase receipt may deliberately carry a 0 minor-unit cost.
      incoming_cost_is_known := true;
    else
      incoming_cost_is_known := current_cost_is_known;
    end if;
  else
    incoming_cost_is_known := current_cost_is_known;
  end if;

  if target_quantity_delta > 0
    and target_movement_type in ('RECEIPT', 'TRANSFER_IN', 'PRODUCTION')
    and next_quantity > 0 then
    next_average_cost := round(
      ((current_quantity * current_average_cost) + (target_quantity_delta * resolved_unit_cost))
      / next_quantity
    )::bigint;
    next_cost_is_known := case
      when current_quantity <= 0 then coalesce(incoming_cost_is_known, false)
      else coalesce(current_cost_is_known, false) and coalesce(incoming_cost_is_known, false)
    end;
  elsif target_quantity_delta > 0 and current_quantity = 0 and current_average_cost = 0 then
    next_average_cost := resolved_unit_cost;
  end if;

  movement_cost_is_known := case
    when target_quantity_delta > 0 then coalesce(incoming_cost_is_known, false)
    else coalesce(current_cost_is_known, false)
  end;

  update public.inventory_levels
  set quantity = next_quantity,
      average_cost_minor = next_average_cost,
      cost_is_known = next_cost_is_known,
      updated_at = now()
  where organization_id = target_organization_id
    and store_id = target_store_id
    and product_id = target_product_id
    and variant_id is not distinct from target_variant_id;

  insert into public.inventory_movements (
    organization_id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after,
    movement_type, actor_employee_id, reason, source_type, source_id,
    unit_cost_minor, value_delta_minor, reason_code, cost_is_known
  ) values (
    target_organization_id, target_store_id, target_product_id, target_variant_id,
    target_quantity_delta, current_quantity, next_quantity, target_movement_type,
    target_actor_employee_id, btrim(target_reason),
    case when target_source_id is null then null else target_source_type end,
    target_source_id, resolved_unit_cost,
    round(target_quantity_delta * resolved_unit_cost)::bigint,
    target_reason_code, movement_cost_is_known
  );
end;
$$;

create or replace function private.produce_composite(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_quantity numeric,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  components_cost_known boolean := true;
  normalized_note text;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
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
    select 1
    from public.products product
    where product.id = target_product_id
      and product.organization_id = target_organization_id
      and product.is_composite
      and product.track_inventory
      and product.status = 'active'
  ) then
    raise exception 'Choose an active composite inventory product.' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.product_components recipe
    where recipe.organization_id = target_organization_id
      and recipe.product_id = target_product_id
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

  perform 1
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and (
      level.product_id = target_product_id
      or exists (
        select 1
        from public.product_components recipe
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
    target_organization_id, target_store_id, target_product_id, target_quantity,
    actor_id, normalized_note, target_operation_id
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
    select *
    from public.product_components item
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
    components_cost_known := components_cost_known and component_level.cost_is_known;
    perform private.apply_inventory_change_v2(
      target_organization_id, target_store_id, component_level.product_id, component_level.variant_id,
      -component_quantity, 'PRODUCTION', actor_id, 'Consumed by production', 'production_run',
      run_id, component_level.average_cost_minor
    );
  end loop;

  output_unit_cost := round(total_cost / target_quantity)::bigint;
  update public.production_runs
  set cost_is_known = components_cost_known
  where id = run_id
    and organization_id = target_organization_id;

  perform private.apply_inventory_change_v2(
    target_organization_id, target_store_id, target_product_id, null, target_quantity,
    'PRODUCTION', actor_id, 'Produced composite stock', 'production_run', run_id, output_unit_cost
  );

  perform private.write_audit_log(
    target_organization_id, 'PRODUCTION_COMPLETED', 'inventory.manage', actor_id, null,
    target_store_id, null, null, null, target_note,
    jsonb_build_object(
      'production_run_id', run_id,
      'product_id', target_product_id,
      'quantity', target_quantity,
      'unit_cost_minor', output_unit_cost,
      'cost_is_known', components_cost_known,
      'operation_id', target_operation_id
    )
  );
  return run_id;
end;
$$;

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
    case
      when level.cost_is_known then round(level.quantity * level.average_cost_minor)::bigint
      else null::bigint
    end as value_minor
  from public.inventory_levels level
  where (select auth.uid()) is not null
    and level.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'products.view_cost'))
    and (select private.has_inventory_capability(target_organization_id, 'inventory.valuation.view'))
    and (select private.has_store_read_scope(target_organization_id, level.store_id));
$$;

revoke all on function public.get_inventory_valuation(uuid) from public, anon;
grant execute on function public.get_inventory_valuation(uuid) to authenticated;

comment on column public.inventory_levels.cost_is_known is
  'True only when the current weighted-average cost is supported by a known cost source. Historical ambiguous zeroes remain false until a controlled costed workflow establishes a new basis.';

comment on column public.inventory_movements.cost_is_known is
  'Immutable indication that the movement cost was supplied by a known cost source. A numeric zero may be known or unknown; use this flag to distinguish them.';

comment on column public.stock_transfer_lines.unit_cost_is_known is
  'Carries source-store cost truth into a transfer receipt so a zero cost is not confused with an unverified cost.';

comment on column public.production_runs.cost_is_known is
  'True only when every consumed component had a known cost at production time.';

comment on function public.get_inventory_valuation(uuid) is
  'Returns store-scoped valuation only to cost-authorized employees with inventory.valuation.view. Unknown cost positions return NULL value_minor and must not be treated as zero-value inventory.';

commit;
