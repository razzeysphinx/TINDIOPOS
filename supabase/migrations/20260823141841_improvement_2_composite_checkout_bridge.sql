-- Composite products use the existing simple-product checkout path. This keeps
-- sales, payment idempotency, and stock locking in one proven transaction,
-- while the ledger trigger appends an auditable movement for every component.

begin;

alter table public.products
  add column is_composite boolean not null default false;

alter table public.products
  add constraint products_composite_type_consistency check (
    not is_composite or product_type = 'simple'
  );

create or replace function private.validate_product_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_is_composite boolean;
  component_type text;
begin
  select is_composite into parent_is_composite
  from public.products
  where id = new.product_id and organization_id = new.organization_id;

  select product_type into component_type
  from public.products
  where id = new.component_product_id and organization_id = new.organization_id;

  if not coalesce(parent_is_composite, false) then
    raise exception 'Only composite products can have component recipes.' using errcode = '23514';
  end if;

  if component_type is null then
    raise exception 'Each component must belong to this organization.' using errcode = '23503';
  end if;

  if component_type = 'variable' and new.component_variant_id is null then
    raise exception 'Choose a specific variant for a variable component.' using errcode = '23514';
  end if;

  if component_type <> 'variable' and new.component_variant_id is not null then
    raise exception 'Only variable components can use a variant.' using errcode = '23514';
  end if;

  if exists (
    with recursive descendants(product_id) as (
      select component.component_product_id
      from public.product_components component
      where component.organization_id = new.organization_id
        and component.product_id = new.component_product_id
      union
      select component.component_product_id
      from public.product_components component
      join descendants descendant on descendant.product_id = component.product_id
      where component.organization_id = new.organization_id
    )
    select 1 from descendants where product_id = new.product_id
  ) then
    raise exception 'A composite product cannot contain itself through a component chain.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.create_catalog_product_v2(
  target_organization_id uuid, target_category_id uuid, target_name text,
  target_description text, target_product_type text, target_sku text,
  target_barcode text, target_price_minor bigint, target_cost_minor bigint,
  target_track_inventory boolean, target_unit text, target_store_ids uuid[],
  target_variants jsonb, target_image_url text, target_is_variable_price boolean,
  target_allow_fractional_quantity boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_product_id uuid; normalized_type text;
begin
  normalized_type := case when target_product_type = 'composite' then 'simple' else target_product_type end;
  if target_product_type = 'composite'
    and jsonb_array_length(coalesce(target_variants, '[]'::jsonb)) <> 0 then
    raise exception 'Composite products cannot contain saleable variants.' using errcode = '23514';
  end if;
  if target_product_type = 'composite' and not target_track_inventory then
    raise exception 'Composite products must track inventory to record component movements.' using errcode = '23514';
  end if;
  new_product_id := private.create_catalog_product(
    target_organization_id, target_category_id, target_name, target_description,
    normalized_type, target_sku, target_barcode, target_price_minor,
    target_cost_minor, target_track_inventory, target_unit, target_store_ids, target_variants
  );
  update public.products
  set image_url = nullif(btrim(target_image_url), ''),
      is_variable_price = coalesce(target_is_variable_price, false),
      allow_fractional_quantity = coalesce(target_allow_fractional_quantity, false),
      is_composite = target_product_type = 'composite'
  where id = new_product_id and organization_id = target_organization_id;
  return new_product_id;
end;
$$;

create or replace function private.record_composite_component_movements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  component record;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
begin
  if tg_op <> 'INSERT' or new.movement_type <> 'SALE' or new.source_type <> 'sale'
    or pg_trigger_depth() > 1
    or not exists (
      select 1 from public.products parent
      where parent.id = new.product_id and parent.organization_id = new.organization_id
        and parent.is_composite
    ) then
    return new;
  end if;

  for component in
    select recipe.component_product_id, recipe.component_variant_id,
      recipe.quantity_per_composite, product.name
    from public.product_components recipe
    join public.products product
      on product.id = recipe.component_product_id
     and product.organization_id = recipe.organization_id
    where recipe.organization_id = new.organization_id
      and recipe.product_id = new.product_id
      and product.track_inventory
  loop
    select level.quantity into current_quantity
    from public.inventory_levels level
    where level.organization_id = new.organization_id and level.store_id = new.store_id
      and level.product_id = component.component_product_id
      and level.variant_id is not distinct from component.component_variant_id
    for update;

    if current_quantity is null then
      raise exception 'The stock projection is not initialized for composite component %.', component.name
        using errcode = '23514';
    end if;

    next_quantity := current_quantity + new.quantity_delta * component.quantity_per_composite;
    update public.inventory_levels level set quantity = next_quantity, updated_at = now()
    where level.organization_id = new.organization_id and level.store_id = new.store_id
      and level.product_id = component.component_product_id
      and level.variant_id is not distinct from component.component_variant_id;

    insert into public.inventory_movements (
      organization_id, store_id, product_id, variant_id, quantity_delta,
      quantity_before, quantity_after, movement_type, actor_employee_id, reason,
      source_type, source_id
    ) values (
      new.organization_id, new.store_id, component.component_product_id,
      component.component_variant_id,
      new.quantity_delta * component.quantity_per_composite,
      current_quantity, next_quantity, 'SALE', new.actor_employee_id,
      'Composite sale: ' || new.reason, 'composite_sale', new.source_id
    );
  end loop;
  return new;
end;
$$;

revoke execute on function private.record_composite_component_movements()
from public, anon, authenticated, service_role;

create trigger inventory_movements_record_composite_components
after insert on public.inventory_movements
for each row execute function private.record_composite_component_movements();

grant select (is_composite) on public.products to authenticated;
grant update (is_composite) on public.products to authenticated;

comment on column public.products.is_composite is 'Uses the simple checkout contract and emits component ledger movements when sold.';

commit;
