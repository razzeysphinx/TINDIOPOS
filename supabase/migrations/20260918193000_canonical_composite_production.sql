begin;

-- Phase 12: composite production and recipe-consumption ownership.
--
-- A composite may consume its recipe either when it is sold (made_to_order)
-- or when finished stock is produced (stocked_assembly), never both.
alter table public.products
  add column if not exists composite_inventory_mode text not null default 'made_to_order';

alter table public.products
  drop constraint if exists products_composite_inventory_mode_values;

alter table public.products
  add constraint products_composite_inventory_mode_values
  check (composite_inventory_mode in ('made_to_order', 'stocked_assembly'));

alter table public.products
  drop constraint if exists products_composite_inventory_mode_consistency;
alter table public.products
  add constraint products_composite_inventory_mode_consistency
  check (is_composite or composite_inventory_mode = 'made_to_order');

-- Preserve observed behavior for existing products. A composite with historical
-- production evidence is a stocked assembly; every other existing composite
-- retains the legacy sale-time recipe behavior.
update public.products product
set composite_inventory_mode = 'stocked_assembly'
where product.is_composite
  and exists (
    select 1
    from public.production_runs production_run
    where production_run.organization_id = product.organization_id
      and production_run.product_id = product.id
  );

comment on column public.products.composite_inventory_mode is
  'Composite stock authority. made_to_order consumes recipe components on sale; stocked_assembly consumes components only through production and sells finished stock.';

grant select (composite_inventory_mode) on public.products to authenticated;

create or replace function private.protect_composite_inventory_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (new.composite_inventory_mode is distinct from old.composite_inventory_mode
      or new.is_composite is distinct from old.is_composite)
    and (
      exists (
        select 1
        from public.inventory_movements movement
        where movement.organization_id = old.organization_id
          and movement.product_id = old.id
      )
      or exists (
        select 1
        from public.production_runs production_run
        where production_run.organization_id = old.organization_id
          and production_run.product_id = old.id
      )
    ) then
    raise exception 'Composite stock mode cannot change after inventory history begins.'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke execute on function private.protect_composite_inventory_mode()
from public, anon, authenticated, service_role;

drop trigger if exists products_protect_composite_inventory_mode on public.products;
create trigger products_protect_composite_inventory_mode
before update of composite_inventory_mode, is_composite on public.products
for each row execute function private.protect_composite_inventory_mode();

-- New application creation route with an explicit composite inventory contract.
create or replace function public.create_catalog_product_v3(
  target_organization_id uuid,
  target_category_id uuid,
  target_name text,
  target_description text,
  target_product_type text,
  target_sku text,
  target_barcode text,
  target_price_minor bigint,
  target_cost_minor bigint,
  target_track_inventory boolean,
  target_unit text,
  target_store_ids uuid[],
  target_variants jsonb,
  target_image_url text,
  target_is_variable_price boolean,
  target_allow_fractional_quantity boolean,
  target_composite_inventory_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_product_id uuid;
  normalized_mode text := coalesce(nullif(btrim(target_composite_inventory_mode), ''), 'made_to_order');
begin
  if normalized_mode not in ('made_to_order', 'stocked_assembly') then
    raise exception 'Choose a supported composite inventory mode.' using errcode = '23514';
  end if;

  new_product_id := private.create_catalog_product_v2(
    target_organization_id,
    target_category_id,
    target_name,
    target_description,
    target_product_type,
    target_sku,
    target_barcode,
    target_price_minor,
    target_cost_minor,
    target_track_inventory,
    target_unit,
    target_store_ids,
    target_variants,
    target_image_url,
    target_is_variable_price,
    target_allow_fractional_quantity
  );

  update public.products
  set composite_inventory_mode = case
    when is_composite then normalized_mode
    else 'made_to_order'
  end
  where id = new_product_id
    and organization_id = target_organization_id;

  return new_product_id;
end;
$function$;

create or replace function public.update_catalog_product_v3(
  target_organization_id uuid,
  target_product_id uuid,
  target_name text,
  target_description text,
  target_category_id uuid,
  target_sku text,
  target_barcode text,
  target_price_minor bigint,
  target_cost_minor bigint,
  target_track_inventory boolean,
  target_unit text,
  target_image_url text,
  target_is_variable_price boolean,
  target_allow_fractional_quantity boolean,
  target_composite_inventory_mode text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result_product_type text;
  product_is_composite boolean;
  normalized_mode text := coalesce(nullif(btrim(target_composite_inventory_mode), ''), 'made_to_order');
begin
  if normalized_mode not in ('made_to_order', 'stocked_assembly') then
    raise exception 'Choose a supported composite inventory mode.' using errcode = '23514';
  end if;

  result_product_type := private.update_catalog_product_v2(
    target_organization_id,
    target_product_id,
    target_name,
    target_description,
    target_category_id,
    target_sku,
    target_barcode,
    target_price_minor,
    target_cost_minor,
    target_track_inventory,
    target_unit,
    target_image_url,
    target_is_variable_price,
    target_allow_fractional_quantity
  );

  select product.is_composite
  into product_is_composite
  from public.products product
  where product.id = target_product_id
    and product.organization_id = target_organization_id;

  update public.products
  set composite_inventory_mode = case
    when product_is_composite then normalized_mode
    else 'made_to_order'
  end
  where id = target_product_id
    and organization_id = target_organization_id;

  return result_product_type;
end;
$function$;

revoke all on function public.create_catalog_product_v3(uuid,uuid,text,text,text,text,text,bigint,bigint,boolean,text,uuid[],jsonb,text,boolean,boolean,text)
from public, anon, service_role;
revoke all on function public.update_catalog_product_v3(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean,text)
from public, anon, service_role;
grant execute on function public.create_catalog_product_v3(uuid,uuid,text,text,text,text,text,bigint,bigint,boolean,text,uuid[],jsonb,text,boolean,boolean,text)
to authenticated;
grant execute on function public.update_catalog_product_v3(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean,text)
to authenticated;

comment on function public.create_catalog_product_v3(uuid,uuid,text,text,text,text,text,bigint,bigint,boolean,text,uuid[],jsonb,text,boolean,boolean,text)
is 'Catalog creation with an explicit composite recipe-consumption mode.';
comment on function public.update_catalog_product_v3(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean,text)
is 'Catalog update with an explicit composite recipe-consumption mode.';

-- The existing sale bridge remains a compatibility boundary for historical
-- checkout implementations, but it must never consume a stocked assembly's
-- recipe after that recipe was already consumed by production.
create or replace function private.record_composite_component_movements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  component record;
  component_level public.inventory_levels%rowtype;
  component_delta numeric(14,3);
begin
  if tg_op <> 'INSERT'
    or new.movement_type <> 'SALE'
    or new.source_type <> 'sale'
    or pg_trigger_depth() > 1
    or not exists (
      select 1
      from public.products parent
      where parent.id = new.product_id
        and parent.organization_id = new.organization_id
        and parent.is_composite
        and parent.composite_inventory_mode = 'made_to_order'
    ) then
    return new;
  end if;

  for component in
    select
      recipe.component_product_id,
      recipe.component_variant_id,
      recipe.quantity_per_composite,
      product.name
    from public.product_components recipe
    join public.products product
      on product.id = recipe.component_product_id
     and product.organization_id = recipe.organization_id
    where recipe.organization_id = new.organization_id
      and recipe.product_id = new.product_id
      and product.track_inventory
    order by recipe.component_product_id, recipe.component_variant_id
  loop
    component_delta := new.quantity_delta * component.quantity_per_composite;

    select level.*
    into component_level
    from public.inventory_levels level
    where level.organization_id = new.organization_id
      and level.store_id = new.store_id
      and level.product_id = component.component_product_id
      and level.variant_id is not distinct from component.component_variant_id
    for update;

    if component_level.id is null then
      raise exception 'The stock projection is not initialized for composite component %.', component.name
        using errcode = '23514';
    end if;

    perform private.apply_inventory_change_v2(
      new.organization_id,
      new.store_id,
      component.component_product_id,
      component.component_variant_id,
      component_delta,
      'SALE',
      new.actor_employee_id,
      'Composite sale: ' || new.reason,
      'composite_sale',
      new.source_id,
      component_level.average_cost_minor
    );
  end loop;

  return new;
end;
$function$;

revoke execute on function private.record_composite_component_movements()
from public, anon, authenticated, service_role;

-- Production evidence is immutable and snapshots the exact recipe and cost used.
alter table public.production_runs
  add column if not exists normalized_payload jsonb,
  add column if not exists composite_inventory_mode_snapshot text;

update public.production_runs production_run
set normalized_payload = jsonb_build_object(
      'store_id', production_run.store_id,
      'product_id', production_run.product_id,
      'quantity', production_run.quantity_produced,
      'note', production_run.note,
      'composite_inventory_mode', 'stocked_assembly'
    ),
    composite_inventory_mode_snapshot = 'stocked_assembly'
where normalized_payload is null
   or composite_inventory_mode_snapshot is null;

alter table public.production_runs
  alter column normalized_payload set not null,
  alter column composite_inventory_mode_snapshot set not null,
  alter column composite_inventory_mode_snapshot set default 'stocked_assembly';

alter table public.production_runs
  drop constraint if exists production_runs_composite_mode_snapshot_values;
alter table public.production_runs
  add constraint production_runs_composite_mode_snapshot_values
  check (composite_inventory_mode_snapshot = 'stocked_assembly');

create table public.production_run_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  production_run_id uuid not null,
  component_product_id uuid not null,
  component_variant_id uuid,
  quantity_per_composite_snapshot numeric(14,3) not null,
  quantity_consumed numeric(14,3) not null,
  unit_snapshot text not null,
  unit_cost_minor bigint not null,
  cost_is_known boolean not null,
  total_cost_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint production_run_components_run_organization_fkey
    foreign key (production_run_id, organization_id)
    references public.production_runs (id, organization_id) on delete restrict,
  constraint production_run_components_product_organization_fkey
    foreign key (component_product_id, organization_id)
    references public.products (id, organization_id) on delete restrict,
  constraint production_run_components_variant_product_organization_fkey
    foreign key (component_variant_id, component_product_id, organization_id)
    references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint production_run_components_quantities_positive
    check (quantity_per_composite_snapshot > 0 and quantity_consumed > 0),
  constraint production_run_components_quantity_precision
    check (
      quantity_per_composite_snapshot = round(quantity_per_composite_snapshot, 3)
      and quantity_consumed = round(quantity_consumed, 3)
    ),
  constraint production_run_components_cost_nonnegative
    check (unit_cost_minor >= 0 and total_cost_minor >= 0),
  constraint production_run_components_identity_unique
    unique nulls not distinct (production_run_id, component_product_id, component_variant_id)
);

create index production_run_components_run_idx
  on public.production_run_components (organization_id, production_run_id);

-- Reconstruct historical component snapshots from the append-only production ledger.
insert into public.production_run_components (
  organization_id,
  production_run_id,
  component_product_id,
  component_variant_id,
  quantity_per_composite_snapshot,
  quantity_consumed,
  unit_snapshot,
  unit_cost_minor,
  cost_is_known,
  total_cost_minor,
  created_at
)
select
  movement.organization_id,
  production_run.id,
  movement.product_id,
  movement.variant_id,
  round(abs(movement.quantity_delta) / production_run.quantity_produced, 3),
  abs(movement.quantity_delta),
  movement.unit_snapshot,
  movement.unit_cost_minor,
  movement.cost_is_known,
  abs(movement.value_delta_minor),
  movement.created_at
from public.inventory_movements movement
join public.production_runs production_run
  on production_run.id = movement.source_id
 and production_run.organization_id = movement.organization_id
where movement.source_type = 'production_run'
  and movement.quantity_delta < 0
  and production_run.quantity_produced > 0
on conflict (production_run_id, component_product_id, component_variant_id)
do nothing;

alter table public.production_run_components enable row level security;
revoke all on public.production_run_components from public, anon, authenticated, service_role;
grant select (
  id,
  organization_id,
  production_run_id,
  component_product_id,
  component_variant_id,
  quantity_per_composite_snapshot,
  quantity_consumed,
  unit_snapshot,
  created_at
) on public.production_run_components to authenticated;

create policy production_run_components_select_authorized_scope
on public.production_run_components
for select
to authenticated
using (
  (select private.has_permission(organization_id, 'inventory.manage'))
  and exists (
    select 1
    from public.production_runs production_run
    where production_run.id = production_run_components.production_run_id
      and production_run.organization_id = production_run_components.organization_id
      and (select private.has_store_read_scope(production_run.organization_id, production_run.store_id))
  )
);

create or replace function private.prevent_production_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'Posted production evidence is immutable. Record a new production or correcting stock transaction instead.'
    using errcode = '55000';
end;
$function$;

revoke execute on function private.prevent_production_evidence_mutation()
from public, anon, authenticated, service_role;

drop trigger if exists production_runs_guard_immutable on public.production_runs;
create trigger production_runs_guard_immutable
before update or delete on public.production_runs
for each row execute function private.prevent_production_evidence_mutation();

drop trigger if exists production_run_components_guard_immutable on public.production_run_components;
create trigger production_run_components_guard_immutable
before update or delete on public.production_run_components
for each row execute function private.prevent_production_evidence_mutation();

revoke insert, update, delete on public.production_runs from authenticated;
revoke insert, update, delete on public.production_run_components from authenticated;

-- Retire direct and non-idempotent production engines. The public six-argument
-- command below is the sole application write boundary.
drop function if exists public.produce_composite(uuid,uuid,uuid,numeric,text);
drop function if exists private.produce_composite(uuid,uuid,uuid,numeric,text);
drop function if exists private.produce_composite(uuid,uuid,uuid,numeric,text,uuid);

create or replace function public.produce_composite(
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
as $function$
declare
  actor_id uuid;
  run_id uuid := gen_random_uuid();
  existing_run public.production_runs%rowtype;
  output_level public.inventory_levels%rowtype;
  component_level public.inventory_levels%rowtype;
  component record;
  normalized_note text := nullif(btrim(target_note), '');
  normalized_payload jsonb;
  recipe_snapshot jsonb;
  cost_snapshot jsonb := '[]'::jsonb;
  component_quantity numeric(14,3);
  total_cost numeric := 0;
  output_unit_cost bigint;
  components_cost_known boolean := true;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable production operation ID is required.' using errcode = '23514';
  end if;

  if target_quantity is null
    or target_quantity <= 0
    or target_quantity <> round(target_quantity, 3) then
    raise exception 'Production quantity must be positive and use at most three decimals.' using errcode = '23514';
  end if;

  normalized_payload := jsonb_build_object(
    'store_id', target_store_id,
    'product_id', target_product_id,
    'quantity', target_quantity,
    'note', normalized_note,
    'composite_inventory_mode', 'stocked_assembly'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':composite-production:' || target_operation_id::text,
      0
    )
  );

  select production_run.*
  into existing_run
  from public.production_runs production_run
  where production_run.organization_id = target_organization_id
    and production_run.operation_id = target_operation_id;

  if found then
    if existing_run.normalized_payload is distinct from normalized_payload then
      raise exception 'This operation ID is already assigned to a different production payload.'
        using errcode = '23505';
    end if;
    return existing_run.id;
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
      and product.composite_inventory_mode = 'stocked_assembly'
      and product.track_inventory
      and product.status = 'active'
  ) then
    raise exception 'Choose an active stocked-assembly composite product.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.product_components recipe
    join public.products component_product
      on component_product.id = recipe.component_product_id
     and component_product.organization_id = recipe.organization_id
    where recipe.organization_id = target_organization_id
      and recipe.product_id = target_product_id
      and not component_product.track_inventory
  ) then
    raise exception 'Stocked assembly recipe components must track inventory.'
      using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'component_product_id', recipe.component_product_id,
        'component_variant_id', recipe.component_variant_id,
        'quantity_per_composite', recipe.quantity_per_composite,
        'unit_snapshot', component_product.unit
      )
      order by recipe.component_product_id, recipe.component_variant_id
    ),
    '[]'::jsonb
  )
  into recipe_snapshot
  from public.product_components recipe
  join public.products component_product
    on component_product.id = recipe.component_product_id
   and component_product.organization_id = recipe.organization_id
   and component_product.track_inventory
  where recipe.organization_id = target_organization_id
    and recipe.product_id = target_product_id;

  if jsonb_array_length(recipe_snapshot) = 0 then
    raise exception 'This stocked assembly needs at least one tracked recipe component.'
      using errcode = '23514';
  end if;

  -- Lock every participating stock projection in deterministic identity order.
  perform 1
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and (
      (level.product_id = target_product_id and level.variant_id is null)
      or exists (
        select 1
        from jsonb_to_recordset(recipe_snapshot) as recipe(
          component_product_id uuid,
          component_variant_id uuid,
          quantity_per_composite numeric,
          unit_snapshot text
        )
        where recipe.component_product_id = level.product_id
          and recipe.component_variant_id is not distinct from level.variant_id
      )
    )
  order by level.product_id, level.variant_id nulls first
  for update;

  select level.*
  into output_level
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and level.product_id = target_product_id
    and level.variant_id is null;

  if output_level.id is null then
    raise exception 'The composite output stock projection is not initialized.'
      using errcode = '23514';
  end if;

  for component in
    select *
    from jsonb_to_recordset(recipe_snapshot) as recipe(
      component_product_id uuid,
      component_variant_id uuid,
      quantity_per_composite numeric,
      unit_snapshot text
    )
    order by component_product_id, component_variant_id
  loop
    component_quantity := round(component.quantity_per_composite * target_quantity, 3);

    select level.*
    into component_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = component.component_product_id
      and level.variant_id is not distinct from component.component_variant_id;

    if component_level.id is null then
      raise exception 'One production component has no initialized stock projection.'
        using errcode = '23514';
    end if;

    if component_level.quantity < component_quantity then
      raise exception 'One production component has insufficient stock.'
        using errcode = '23514';
    end if;

    total_cost := total_cost + component_quantity * component_level.average_cost_minor;
    components_cost_known := components_cost_known and component_level.cost_is_known;

    cost_snapshot := cost_snapshot || jsonb_build_array(
      jsonb_build_object(
        'component_product_id', component.component_product_id,
        'component_variant_id', component.component_variant_id,
        'quantity_per_composite', component.quantity_per_composite,
        'quantity_consumed', component_quantity,
        'unit_snapshot', component.unit_snapshot,
        'unit_cost_minor', component_level.average_cost_minor,
        'cost_is_known', component_level.cost_is_known,
        'total_cost_minor', round(component_quantity * component_level.average_cost_minor)::bigint
      )
    );
  end loop;

  output_unit_cost := round(total_cost / target_quantity)::bigint;

  insert into public.production_runs (
    id,
    organization_id,
    store_id,
    product_id,
    quantity_produced,
    produced_by_employee_id,
    note,
    operation_id,
    cost_is_known,
    normalized_payload,
    composite_inventory_mode_snapshot
  ) values (
    run_id,
    target_organization_id,
    target_store_id,
    target_product_id,
    target_quantity,
    actor_id,
    normalized_note,
    target_operation_id,
    components_cost_known,
    normalized_payload,
    'stocked_assembly'
  );

  insert into public.production_run_components (
    organization_id,
    production_run_id,
    component_product_id,
    component_variant_id,
    quantity_per_composite_snapshot,
    quantity_consumed,
    unit_snapshot,
    unit_cost_minor,
    cost_is_known,
    total_cost_minor
  )
  select
    target_organization_id,
    run_id,
    component.component_product_id,
    component.component_variant_id,
    component.quantity_per_composite,
    component.quantity_consumed,
    component.unit_snapshot,
    component.unit_cost_minor,
    component.cost_is_known,
    component.total_cost_minor
  from jsonb_to_recordset(cost_snapshot) as component(
    component_product_id uuid,
    component_variant_id uuid,
    quantity_per_composite numeric,
    quantity_consumed numeric,
    unit_snapshot text,
    unit_cost_minor bigint,
    cost_is_known boolean,
    total_cost_minor bigint
  );

  for component in
    select *
    from jsonb_to_recordset(cost_snapshot) as recipe(
      component_product_id uuid,
      component_variant_id uuid,
      quantity_per_composite numeric,
      quantity_consumed numeric,
      unit_snapshot text,
      unit_cost_minor bigint,
      cost_is_known boolean,
      total_cost_minor bigint
    )
    order by component_product_id, component_variant_id
  loop
    perform private.apply_inventory_change_v2(
      target_organization_id,
      target_store_id,
      component.component_product_id,
      component.component_variant_id,
      -component.quantity_consumed,
      'PRODUCTION',
      actor_id,
      'Consumed by production',
      'production_run',
      run_id,
      component.unit_cost_minor
    );
  end loop;

  perform private.apply_inventory_change_v2(
    target_organization_id,
    target_store_id,
    target_product_id,
    null,
    target_quantity,
    'PRODUCTION',
    actor_id,
    'Produced composite stock',
    'production_run',
    run_id,
    output_unit_cost
  );

  perform private.write_audit_log(
    target_organization_id,
    'PRODUCTION_COMPLETED',
    'inventory.manage',
    actor_id,
    null,
    target_store_id,
    null,
    null,
    null,
    target_note,
    jsonb_build_object(
      'production_run_id', run_id,
      'product_id', target_product_id,
      'quantity', target_quantity,
      'unit_cost_minor', output_unit_cost,
      'cost_is_known', components_cost_known,
      'operation_id', target_operation_id,
      'composite_inventory_mode', 'stocked_assembly'
    )
  );

  return run_id;
end;
$function$;

revoke all on function public.produce_composite(uuid,uuid,uuid,numeric,text,uuid)
from public, anon, service_role;
grant execute on function public.produce_composite(uuid,uuid,uuid,numeric,text,uuid)
to authenticated;

comment on function public.produce_composite(uuid,uuid,uuid,numeric,text,uuid)
is 'Canonical replay-safe stocked-assembly production command. It snapshots recipe/cost evidence, consumes components once, and posts finished output atomically.';

notify pgrst, 'reload schema';

commit;
