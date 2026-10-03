-- TINDIO Phase 2: catalogue, variants, store availability, and basic stock.
-- Money is stored in minor units. Stock is a three-decimal exact quantity.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  description text,
  icon text,
  color text,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_id_organization_unique unique (id, organization_id),
  constraint categories_name_length check (char_length(name) between 1 and 100),
  constraint categories_description_length check (
    description is null or char_length(description) <= 500
  ),
  constraint categories_icon_format check (
    icon is null or icon ~ '^[a-z][a-z0-9-]{0,39}$'
  ),
  constraint categories_color_format check (
    color is null or color ~ '^#[0-9A-F]{6}$'
  ),
  constraint categories_sort_order_nonnegative check (sort_order >= 0)
);

create unique index categories_organization_name_unique_idx
  on public.categories (organization_id, lower(name));
create index categories_organization_order_idx
  on public.categories (organization_id, is_archived, sort_order, lower(name));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  category_id uuid,
  name text not null,
  description text,
  product_type text not null default 'simple',
  sku text,
  barcode text,
  price_minor bigint not null default 0,
  cost_minor bigint not null default 0,
  track_inventory boolean not null default false,
  unit text not null default 'each',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_id_organization_unique unique (id, organization_id),
  constraint products_category_organization_fkey
    foreign key (category_id, organization_id)
    references public.categories (id, organization_id)
    on delete restrict,
  constraint products_name_length check (char_length(name) between 1 and 160),
  constraint products_description_length check (
    description is null or char_length(description) <= 2000
  ),
  constraint products_type_values check (product_type in ('simple', 'variable')),
  constraint products_sku_format check (
    sku is null or (
      sku = upper(trim(sku))
      and sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'
    )
  ),
  constraint products_barcode_format check (
    barcode is null or (
      barcode = trim(barcode)
      and barcode ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
    )
  ),
  constraint products_variable_identifiers check (
    product_type = 'simple' or (sku is null and barcode is null)
  ),
  constraint products_price_nonnegative check (price_minor >= 0),
  constraint products_cost_nonnegative check (cost_minor >= 0),
  constraint products_unit_format check (
    char_length(unit) between 1 and 24
    and unit ~ '^[A-Za-z][A-Za-z0-9 _-]*$'
  ),
  constraint products_status_values check (status in ('active', 'archived'))
);

create index products_organization_status_name_idx
  on public.products (organization_id, status, lower(name));
create index products_category_id_idx on public.products (category_id);
create unique index products_organization_sku_unique_idx
  on public.products (organization_id, sku)
  where sku is not null;
create unique index products_organization_barcode_unique_idx
  on public.products (organization_id, barcode)
  where barcode is not null;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  product_id uuid not null,
  name text not null,
  option_values jsonb not null default '{}'::jsonb,
  sku text,
  barcode text,
  price_minor bigint not null,
  cost_minor bigint not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_id_organization_unique unique (id, organization_id),
  constraint product_variants_identity_unique unique (id, product_id, organization_id),
  constraint product_variants_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint product_variants_name_length check (char_length(name) between 1 and 160),
  constraint product_variants_option_values_object check (
    jsonb_typeof(option_values) = 'object'
  ),
  constraint product_variants_sku_format check (
    sku is null or (
      sku = upper(trim(sku))
      and sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'
    )
  ),
  constraint product_variants_barcode_format check (
    barcode is null or (
      barcode = trim(barcode)
      and barcode ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
    )
  ),
  constraint product_variants_price_nonnegative check (price_minor >= 0),
  constraint product_variants_cost_nonnegative check (cost_minor >= 0),
  constraint product_variants_sort_order_nonnegative check (sort_order >= 0)
);

create unique index product_variants_product_name_unique_idx
  on public.product_variants (product_id, lower(name));
create index product_variants_organization_product_idx
  on public.product_variants (organization_id, product_id, is_active, sort_order);
create unique index product_variants_organization_sku_unique_idx
  on public.product_variants (organization_id, sku)
  where sku is not null;
create unique index product_variants_organization_barcode_unique_idx
  on public.product_variants (organization_id, barcode)
  where barcode is not null;

create table public.product_store_settings (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, product_id),
  constraint product_store_settings_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete cascade,
  constraint product_store_settings_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete cascade
);

create index product_store_settings_organization_product_idx
  on public.product_store_settings (organization_id, product_id, is_available);
create index product_store_settings_store_available_idx
  on public.product_store_settings (store_id, is_available, product_id);

create table public.inventory_levels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  quantity numeric(14, 3) not null default 0,
  updated_at timestamptz not null default now(),
  constraint inventory_levels_id_organization_unique unique (id, organization_id),
  constraint inventory_levels_saleable_unique
    unique nulls not distinct (organization_id, store_id, product_id, variant_id),
  constraint inventory_levels_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint inventory_levels_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint inventory_levels_variant_product_organization_fkey
    foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id)
    on delete restrict
);

create index inventory_levels_organization_store_idx
  on public.inventory_levels (organization_id, store_id, product_id);
create index inventory_levels_product_id_idx on public.inventory_levels (product_id);
create index inventory_levels_variant_id_idx
  on public.inventory_levels (variant_id)
  where variant_id is not null;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  quantity_delta numeric(14, 3) not null,
  quantity_before numeric(14, 3) not null,
  quantity_after numeric(14, 3) not null,
  movement_type text not null,
  actor_employee_id uuid not null,
  reason text not null,
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now(),
  constraint inventory_movements_id_organization_unique unique (id, organization_id),
  constraint inventory_movements_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint inventory_movements_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint inventory_movements_variant_product_organization_fkey
    foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id)
    on delete restrict,
  constraint inventory_movements_actor_organization_fkey
    foreign key (actor_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint inventory_movements_delta_nonzero check (quantity_delta <> 0),
  constraint inventory_movements_balance_math check (
    quantity_after = quantity_before + quantity_delta
  ),
  constraint inventory_movements_type_values check (
    movement_type in ('OPENING_STOCK', 'ADJUSTMENT')
  ),
  constraint inventory_movements_reason_length check (
    char_length(reason) between 2 and 500
  ),
  constraint inventory_movements_source_pair check (
    (source_type is null and source_id is null)
    or (source_type is not null and source_id is not null)
  ),
  constraint inventory_movements_source_type_length check (
    source_type is null or char_length(source_type) between 2 and 40
  )
);

create index inventory_movements_organization_store_created_idx
  on public.inventory_movements (organization_id, store_id, created_at desc);
create index inventory_movements_product_created_idx
  on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_variant_created_idx
  on public.inventory_movements (variant_id, created_at desc)
  where variant_id is not null;
create index inventory_movements_actor_employee_id_idx
  on public.inventory_movements (actor_employee_id);

create trigger categories_set_updated_at
before update on public.categories
for each row execute function private.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function private.set_updated_at();

create trigger product_store_settings_set_updated_at
before update on public.product_store_settings
for each row execute function private.set_updated_at();

create or replace function private.ensure_catalog_identifier_unique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  identifier_value text;
  conflicting_product_id uuid;
  conflicting_variant_id uuid;
begin
  new.sku := nullif(upper(trim(new.sku)), '');
  new.barcode := nullif(trim(new.barcode), '');

  for identifier_value in
    select distinct identifier
    from unnest(array[new.sku, new.barcode]) as identifier
    where identifier is not null
    order by identifier
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        new.organization_id::text || ':catalog-identifier:' || identifier_value,
        0
      )
    );
  end loop;

  select product.id
  into conflicting_product_id
  from public.products product
  where product.organization_id = new.organization_id
    and (
      product.sku = any(array[new.sku, new.barcode])
      or product.barcode = any(array[new.sku, new.barcode])
    )
    and (tg_table_name <> 'products' or product.id <> new.id)
  limit 1;

  select variant.id
  into conflicting_variant_id
  from public.product_variants variant
  where variant.organization_id = new.organization_id
    and (
      variant.sku = any(array[new.sku, new.barcode])
      or variant.barcode = any(array[new.sku, new.barcode])
    )
    and (tg_table_name <> 'product_variants' or variant.id <> new.id)
  limit 1;

  if conflicting_product_id is not null or conflicting_variant_id is not null then
    raise exception 'SKU and barcode values must identify one saleable item.'
      using errcode = '23505', constraint = 'catalog_identifiers_unique';
  end if;

  return new;
end;
$$;

revoke execute on function private.ensure_catalog_identifier_unique()
from public, anon, authenticated, service_role;

create trigger products_ensure_identifier_unique
before insert or update of sku, barcode on public.products
for each row execute function private.ensure_catalog_identifier_unique();

create trigger product_variants_ensure_identifier_unique
before insert or update of sku, barcode on public.product_variants
for each row execute function private.ensure_catalog_identifier_unique();

create or replace function private.initialize_inventory_levels_for_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tracked boolean;
  item_type text;
begin
  if not new.is_available then
    return new;
  end if;

  select product.track_inventory, product.product_type
  into tracked, item_type
  from public.products product
  where product.id = new.product_id
    and product.organization_id = new.organization_id;

  if not coalesce(tracked, false) then
    return new;
  end if;

  if item_type = 'simple' then
    insert into public.inventory_levels (
      organization_id,
      store_id,
      product_id,
      variant_id,
      quantity
    )
    values (
      new.organization_id,
      new.store_id,
      new.product_id,
      null,
      0
    )
    on conflict on constraint inventory_levels_saleable_unique do nothing;
  else
    insert into public.inventory_levels (
      organization_id,
      store_id,
      product_id,
      variant_id,
      quantity
    )
    select
      new.organization_id,
      new.store_id,
      new.product_id,
      variant.id,
      0
    from public.product_variants variant
    where variant.organization_id = new.organization_id
      and variant.product_id = new.product_id
      and variant.is_active
    on conflict on constraint inventory_levels_saleable_unique do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function private.initialize_inventory_levels_for_setting()
from public, anon, authenticated, service_role;

create trigger product_store_settings_initialize_inventory
after insert or update of is_available on public.product_store_settings
for each row execute function private.initialize_inventory_levels_for_setting();

create or replace function private.create_catalog_product(
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
  target_variants jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_product_id uuid;
  requested_store_count integer;
  valid_store_count integer;
  variant_count integer;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  if target_category_id is not null and not exists (
    select 1
    from public.categories category
    where category.id = target_category_id
      and category.organization_id = target_organization_id
      and not category.is_archived
  ) then
    raise exception 'Select an active category in this organization.' using errcode = '23503';
  end if;

  if target_store_ids is null or cardinality(target_store_ids) = 0 then
    raise exception 'Select at least one active store.' using errcode = '23514';
  end if;

  select count(distinct requested_store_id)
  into requested_store_count
  from unnest(target_store_ids) as requested_store_id;

  select count(*)
  into valid_store_count
  from public.stores store
  where store.organization_id = target_organization_id
    and store.id = any(target_store_ids)
    and store.is_active;

  if requested_store_count <> valid_store_count then
    raise exception 'Every selected store must be active and belong to this organization.'
      using errcode = '23503';
  end if;

  if jsonb_typeof(coalesce(target_variants, '[]'::jsonb)) <> 'array' then
    raise exception 'Variants must be supplied as a JSON array.' using errcode = '22023';
  end if;

  variant_count := jsonb_array_length(coalesce(target_variants, '[]'::jsonb));

  if target_product_type = 'simple' and variant_count <> 0 then
    raise exception 'Simple products cannot contain variants.' using errcode = '23514';
  end if;

  if target_product_type = 'variable' and variant_count not between 1 and 100 then
    raise exception 'Variable products require between 1 and 100 variants.'
      using errcode = '23514';
  end if;

  if (
    coalesce(target_cost_minor, 0) <> 0
    or exists (
      select 1
      from jsonb_array_elements(coalesce(target_variants, '[]'::jsonb)) variant
      where coalesce((variant ->> 'cost_minor')::bigint, 0) <> 0
    )
  ) and not (select private.has_permission(
    target_organization_id,
    'products.view_cost'
  )) then
    raise exception 'Product cost permission is required.' using errcode = '42501';
  end if;

  insert into public.products (
    organization_id,
    category_id,
    name,
    description,
    product_type,
    sku,
    barcode,
    price_minor,
    cost_minor,
    track_inventory,
    unit
  )
  values (
    target_organization_id,
    target_category_id,
    trim(target_name),
    nullif(trim(target_description), ''),
    target_product_type,
    nullif(upper(trim(target_sku)), ''),
    nullif(trim(target_barcode), ''),
    target_price_minor,
    target_cost_minor,
    target_track_inventory,
    lower(trim(target_unit))
  )
  returning id into new_product_id;

  if target_product_type = 'variable' then
    insert into public.product_variants (
      organization_id,
      product_id,
      name,
      option_values,
      sku,
      barcode,
      price_minor,
      cost_minor,
      sort_order
    )
    select
      target_organization_id,
      new_product_id,
      trim(variant.name),
      coalesce(variant.option_values, '{}'::jsonb),
      nullif(upper(trim(variant.sku)), ''),
      nullif(trim(variant.barcode), ''),
      variant.price_minor,
      variant.cost_minor,
      variant.sort_order
    from jsonb_to_recordset(target_variants) as variant(
      name text,
      option_values jsonb,
      sku text,
      barcode text,
      price_minor bigint,
      cost_minor bigint,
      sort_order integer
    );
  end if;

  insert into public.product_store_settings (
    organization_id,
    store_id,
    product_id,
    is_available
  )
  select
    target_organization_id,
    selected_store_id,
    new_product_id,
    true
  from (
    select distinct unnest(target_store_ids) as selected_store_id
  ) selected_stores;

  return new_product_id;
end;
$$;

revoke execute on function private.create_catalog_product(
  uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb
)
from public, anon, authenticated, service_role;

create or replace function public.create_catalog_product(
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
  target_variants jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_catalog_product(
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
    target_variants
  );
$$;

revoke execute on function public.create_catalog_product(
  uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb
)
from public, anon, service_role;
grant execute on function private.create_catalog_product(
  uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb
)
to authenticated;
grant execute on function public.create_catalog_product(
  uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb
)
to authenticated;

create or replace function private.adjust_inventory(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_movement_type text,
  target_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  product_kind text;
  tracks_stock boolean;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  new_movement_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory management permission is required.' using errcode = '42501';
  end if;

  if target_quantity_delta is null
    or target_quantity_delta = 0
    or target_quantity_delta <> round(target_quantity_delta, 3) then
    raise exception 'Quantity must be non-zero with at most three decimal places.'
      using errcode = '23514';
  end if;

  if target_movement_type not in ('OPENING_STOCK', 'ADJUSTMENT') then
    raise exception 'Unsupported inventory movement type.' using errcode = '23514';
  end if;

  if char_length(trim(coalesce(target_reason, ''))) not between 2 and 500 then
    raise exception 'Inventory reason must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  limit 1;

  if actor_id is null then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;

  select product.product_type, product.track_inventory
  into product_kind, tracks_stock
  from public.products product
  join public.product_store_settings setting
    on setting.organization_id = product.organization_id
   and setting.product_id = product.id
   and setting.store_id = target_store_id
   and setting.is_available
  join public.stores store
    on store.id = setting.store_id
   and store.organization_id = setting.organization_id
   and store.is_active
  where product.id = target_product_id
    and product.organization_id = target_organization_id
    and product.status = 'active';

  if product_kind is null or not tracks_stock then
    raise exception 'Select an active, inventory-tracked product available at this store.'
      using errcode = '23514';
  end if;

  if product_kind = 'simple' and target_variant_id is not null then
    raise exception 'Simple products do not accept a variant.' using errcode = '23514';
  end if;

  if product_kind = 'variable' and (
    target_variant_id is null
    or not exists (
      select 1
      from public.product_variants variant
      where variant.id = target_variant_id
        and variant.product_id = target_product_id
        and variant.organization_id = target_organization_id
        and variant.is_active
    )
  ) then
    raise exception 'Select an active variant belonging to this product.'
      using errcode = '23514';
  end if;

  select inventory_level.quantity
  into current_quantity
  from public.inventory_levels inventory_level
  where inventory_level.organization_id = target_organization_id
    and inventory_level.store_id = target_store_id
    and inventory_level.product_id = target_product_id
    and inventory_level.variant_id is not distinct from target_variant_id
  for update;

  if current_quantity is null then
    raise exception 'The stock projection is not initialized for this item and store.'
      using errcode = '23514';
  end if;

  if target_movement_type = 'OPENING_STOCK' and (
    current_quantity <> 0
    or exists (
      select 1
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = target_store_id
        and movement.product_id = target_product_id
        and movement.variant_id is not distinct from target_variant_id
    )
  ) then
    raise exception 'Opening stock can only be recorded once on an untouched item.'
      using errcode = '23514';
  end if;

  next_quantity := current_quantity + target_quantity_delta;

  update public.inventory_levels
  set
    quantity = next_quantity,
    updated_at = now()
  where organization_id = target_organization_id
    and store_id = target_store_id
    and product_id = target_product_id
    and variant_id is not distinct from target_variant_id;

  insert into public.inventory_movements (
    organization_id,
    store_id,
    product_id,
    variant_id,
    quantity_delta,
    quantity_before,
    quantity_after,
    movement_type,
    actor_employee_id,
    reason
  )
  values (
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    current_quantity,
    next_quantity,
    target_movement_type,
    actor_id,
    trim(target_reason)
  )
  returning id into new_movement_id;

  return new_movement_id;
end;
$$;

revoke execute on function private.adjust_inventory(
  uuid, uuid, uuid, uuid, numeric, text, text
)
from public, anon, authenticated, service_role;

create or replace function public.adjust_inventory(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_quantity_delta numeric,
  target_movement_type text,
  target_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.adjust_inventory(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    target_movement_type,
    target_reason
  );
$$;

revoke execute on function public.adjust_inventory(
  uuid, uuid, uuid, uuid, numeric, text, text
)
from public, anon, service_role;
grant execute on function private.adjust_inventory(
  uuid, uuid, uuid, uuid, numeric, text, text
)
to authenticated;
grant execute on function public.adjust_inventory(
  uuid, uuid, uuid, uuid, numeric, text, text
)
to authenticated;

create or replace function private.get_catalog_costs(
  target_organization_id uuid,
  requested_product_ids uuid[]
)
returns table (
  product_id uuid,
  variant_id uuid,
  cost_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(
      target_organization_id,
      'products.view_cost'
    )) then
    raise exception 'Product cost permission is required.' using errcode = '42501';
  end if;

  return query
  select product.id, null::uuid, product.cost_minor
  from public.products product
  where product.organization_id = target_organization_id
    and (
      requested_product_ids is null
      or product.id = any(requested_product_ids)
    )
  union all
  select variant.product_id, variant.id, variant.cost_minor
  from public.product_variants variant
  where variant.organization_id = target_organization_id
    and (
      requested_product_ids is null
      or variant.product_id = any(requested_product_ids)
    );
end;
$$;

revoke execute on function private.get_catalog_costs(uuid, uuid[])
from public, anon, authenticated, service_role;

create or replace function public.get_catalog_costs(
  target_organization_id uuid,
  requested_product_ids uuid[] default null
)
returns table (
  product_id uuid,
  variant_id uuid,
  cost_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_catalog_costs(
    target_organization_id,
    requested_product_ids
  );
$$;

revoke execute on function public.get_catalog_costs(uuid, uuid[])
from public, anon, service_role;
grant execute on function private.get_catalog_costs(uuid, uuid[])
to authenticated;
grant execute on function public.get_catalog_costs(uuid, uuid[])
to authenticated;

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_store_settings enable row level security;
alter table public.inventory_levels enable row level security;
alter table public.inventory_movements enable row level security;

create policy categories_select_member
on public.categories for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy categories_insert_authorized
on public.categories for insert
to authenticated
with check ((select private.has_permission(organization_id, 'products.manage')));

create policy categories_update_authorized
on public.categories for update
to authenticated
using ((select private.has_permission(organization_id, 'products.manage')))
with check ((select private.has_permission(organization_id, 'products.manage')));

create policy products_select_member
on public.products for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy products_update_authorized
on public.products for update
to authenticated
using ((select private.has_permission(organization_id, 'products.manage')))
with check ((select private.has_permission(organization_id, 'products.manage')));

create policy product_variants_select_member
on public.product_variants for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy product_variants_update_authorized
on public.product_variants for update
to authenticated
using ((select private.has_permission(organization_id, 'products.manage')))
with check ((select private.has_permission(organization_id, 'products.manage')));

create policy product_store_settings_select_member
on public.product_store_settings for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy product_store_settings_insert_authorized
on public.product_store_settings for insert
to authenticated
with check ((select private.has_permission(organization_id, 'products.manage')));

create policy product_store_settings_update_authorized
on public.product_store_settings for update
to authenticated
using ((select private.has_permission(organization_id, 'products.manage')))
with check ((select private.has_permission(organization_id, 'products.manage')));

create policy inventory_levels_select_member
on public.inventory_levels for select
to authenticated
using ((select private.is_organization_member(organization_id)));

create policy inventory_movements_select_authorized
on public.inventory_movements for select
to authenticated
using ((select private.has_permission(organization_id, 'inventory.manage')));

revoke all on public.categories
from public, anon, authenticated, service_role;
revoke all on public.products
from public, anon, authenticated, service_role;
revoke all on public.product_variants
from public, anon, authenticated, service_role;
revoke all on public.product_store_settings
from public, anon, authenticated, service_role;
revoke all on public.inventory_levels
from public, anon, authenticated, service_role;
revoke all on public.inventory_movements
from public, anon, authenticated, service_role;

grant select, insert on public.categories to authenticated;
grant update (
  name,
  description,
  icon,
  color,
  sort_order,
  is_archived
) on public.categories to authenticated;

-- Acquisition cost is intentionally omitted. Authorized callers read it
-- through get_catalog_costs, which evaluates products.view_cost in Postgres.
grant select (
  id,
  organization_id,
  category_id,
  name,
  description,
  product_type,
  sku,
  barcode,
  price_minor,
  track_inventory,
  unit,
  status,
  created_at,
  updated_at
) on public.products to authenticated;
grant update (status) on public.products to authenticated;

grant select (
  id,
  organization_id,
  product_id,
  name,
  option_values,
  sku,
  barcode,
  price_minor,
  sort_order,
  is_active,
  created_at,
  updated_at
) on public.product_variants to authenticated;
grant update (is_active) on public.product_variants to authenticated;

grant select on public.product_store_settings to authenticated;
grant insert (
  organization_id,
  store_id,
  product_id,
  is_available
) on public.product_store_settings to authenticated;
grant update (is_available) on public.product_store_settings to authenticated;
grant select on public.inventory_levels to authenticated;
grant select on public.inventory_movements to authenticated;

comment on table public.categories
is 'Organization-owned ordered categories. Archiving preserves product references.';
comment on table public.products
is 'Organization product master. Monetary values are integer minor units.';
comment on column public.products.cost_minor
is 'Acquisition cost. Not directly selectable by authenticated Data API callers.';
comment on table public.product_variants
is 'Saleable variants with independent identifiers and minor-unit pricing.';
comment on table public.product_store_settings
is 'Per-store product availability without duplicating the product master.';
comment on table public.inventory_levels
is 'Controlled store/item stock projection. Direct authenticated writes are prohibited.';
comment on table public.inventory_movements
is 'Append-only inventory ledger. Rows are created only by reviewed database routines.';
comment on function public.create_catalog_product(
  uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb
)
is 'Atomically creates a product, optional variants, store availability, and zero stock projections.';
comment on function public.adjust_inventory(
  uuid, uuid, uuid, uuid, numeric, text, text
)
is 'Records opening stock or an adjustment and updates the locked stock projection atomically.';
comment on function public.get_catalog_costs(uuid, uuid[])
is 'Returns product and variant costs only when the authenticated employee has products.view_cost.';
