-- TINDIO Improvement 2: extend the existing catalog without replacing it.
-- Quantities remain three-decimal numerics everywhere, so conversion factors and
-- component quantities are exact at the same precision as inventory ledgers.

begin;

alter table public.products
  add column image_url text,
  add column is_variable_price boolean not null default false,
  add column allow_fractional_quantity boolean not null default false;

alter table public.products
  add constraint products_image_url_format check (
    image_url is null
    or (char_length(image_url) <= 2048 and image_url ~* '^https?://')
  ),
  add constraint products_variable_price_type check (
    not is_variable_price or product_type in ('simple', 'composite')
  );

alter table public.products
  drop constraint products_type_values,
  add constraint products_type_values check (product_type in ('simple', 'variable', 'composite'));

alter table public.product_store_settings
  add column price_override_minor bigint,
  add column low_stock_level numeric(14, 3);

alter table public.product_store_settings
  add constraint product_store_settings_price_override_nonnegative
    check (price_override_minor is null or price_override_minor >= 0),
  add constraint product_store_settings_low_stock_nonnegative
    check (low_stock_level is null or low_stock_level >= 0),
  add constraint product_store_settings_low_stock_precision
    check (low_stock_level is null or low_stock_level = round(low_stock_level, 3));

create table public.product_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  product_id uuid not null,
  unit_code text not null,
  unit_name text not null,
  factor_to_base numeric(14, 3) not null,
  is_base boolean not null default false,
  is_sale_unit boolean not null default true,
  is_purchase_unit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_units_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete cascade,
  constraint product_units_code_format check (
    unit_code = lower(trim(unit_code))
    and unit_code ~ '^[a-z][a-z0-9 _-]{0,23}$'
  ),
  constraint product_units_name_length check (char_length(trim(unit_name)) between 1 and 80),
  constraint product_units_factor_positive check (factor_to_base > 0),
  constraint product_units_factor_precision check (factor_to_base = round(factor_to_base, 3)),
  constraint product_units_identity_unique unique (product_id, unit_code)
);

create unique index product_units_one_base_per_product_idx
  on public.product_units (product_id) where is_base;
create index product_units_product_sale_idx
  on public.product_units (organization_id, product_id, is_sale_unit);

create table public.product_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  product_id uuid not null,
  component_product_id uuid not null,
  component_variant_id uuid,
  quantity_per_composite numeric(14, 3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_components_parent_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id) on delete cascade,
  constraint product_components_component_organization_fkey
    foreign key (component_product_id, organization_id)
    references public.products (id, organization_id) on delete restrict,
  constraint product_components_variant_organization_fkey
    foreign key (component_variant_id, component_product_id, organization_id)
    references public.product_variants (id, product_id, organization_id) on delete restrict,
  constraint product_components_not_self check (product_id <> component_product_id),
  constraint product_components_quantity_positive check (quantity_per_composite > 0),
  constraint product_components_quantity_precision
    check (quantity_per_composite = round(quantity_per_composite, 3)),
  constraint product_components_identity_unique
    unique nulls not distinct (product_id, component_product_id, component_variant_id)
);

create index product_components_parent_idx
  on public.product_components (organization_id, product_id);
create index product_components_component_idx
  on public.product_components (organization_id, component_product_id);

create trigger product_units_set_updated_at
before update on public.product_units
for each row execute function private.set_updated_at();

create trigger product_components_set_updated_at
before update on public.product_components
for each row execute function private.set_updated_at();

-- Existing products are given their current stock unit as their deterministic
-- base unit. New products receive the same configuration automatically.
insert into public.product_units (
  organization_id, product_id, unit_code, unit_name, factor_to_base, is_base, is_sale_unit
)
select organization_id, id, lower(unit), unit, 1, true, true
from public.products
on conflict (product_id, unit_code) do nothing;

create or replace function private.initialize_product_base_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_units (
    organization_id, product_id, unit_code, unit_name, factor_to_base, is_base, is_sale_unit
  ) values (
    new.organization_id, new.id, lower(new.unit), new.unit, 1, true, true
  ) on conflict (product_id, unit_code) do nothing;
  return new;
end;
$$;

revoke execute on function private.initialize_product_base_unit()
from public, anon, authenticated, service_role;

create trigger products_initialize_base_unit
after insert on public.products
for each row execute function private.initialize_product_base_unit();

create or replace function private.validate_product_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_type text;
  component_type text;
begin
  select product_type into parent_type
  from public.products
  where id = new.product_id and organization_id = new.organization_id;

  select product_type into component_type
  from public.products
  where id = new.component_product_id and organization_id = new.organization_id;

  if parent_type <> 'composite' then
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

revoke execute on function private.validate_product_component()
from public, anon, authenticated, service_role;

create trigger product_components_validate
before insert or update on public.product_components
for each row execute function private.validate_product_component();

-- Retain the existing catalog-search contract, while respecting store prices
-- and making composites discoverable as saleable simple-style items.
create or replace function public.search_pos_catalog(
  target_organization_id uuid,
  target_store_id uuid,
  target_query text default null,
  target_category_id uuid default null,
  target_offset integer default 0,
  target_limit integer default 24
)
returns table (
  product_id uuid, variant_id uuid, category_id uuid, product_name text,
  variant_name text, sku text, barcode text, price_minor bigint, unit text
)
language sql stable security invoker set search_path = '' as $$
  with scope as (
    select target_organization_id organization_id, target_store_id store_id,
      nullif(lower(btrim(coalesce(target_query, ''))), '') search_term,
      target_category_id category_id, target_offset result_offset, target_limit result_limit
    where target_offset >= 0 and target_limit between 1 and 48
      and (select auth.uid()) is not null
      and (select private.has_permission(target_organization_id, 'sales.create'))
      and exists (
        select 1 from public.employees employee
        join public.employee_stores employee_store on employee_store.employee_id = employee.id and employee_store.organization_id = employee.organization_id
        join public.stores store on store.id = employee_store.store_id and store.organization_id = employee_store.organization_id
        where employee.organization_id = target_organization_id and employee.profile_id = (select auth.uid())
          and employee.status = 'active' and employee_store.store_id = target_store_id and store.is_active
      )
  ), saleable_items as (
    select product.id product_id, null::uuid variant_id, product.category_id, product.name product_name,
      null::text variant_name, product.sku, product.barcode,
      coalesce(setting.price_override_minor, product.price_minor) price_minor, product.unit,
      scope.search_term, scope.result_offset, scope.result_limit
    from scope join public.product_store_settings setting on setting.organization_id = scope.organization_id and setting.store_id = scope.store_id and setting.is_available
    join public.products product on product.id = setting.product_id and product.organization_id = setting.organization_id
    where product.status = 'active' and product.product_type in ('simple', 'composite')
      and (scope.category_id is null or product.category_id = scope.category_id)
    union all
    select product.id, variant.id, product.category_id, product.name, variant.name, variant.sku, variant.barcode,
      variant.price_minor, product.unit, scope.search_term, scope.result_offset, scope.result_limit
    from scope join public.product_store_settings setting on setting.organization_id = scope.organization_id and setting.store_id = scope.store_id and setting.is_available
    join public.products product on product.id = setting.product_id and product.organization_id = setting.organization_id
    join public.product_variants variant on variant.product_id = product.id and variant.organization_id = product.organization_id and variant.is_active
    where product.status = 'active' and product.product_type = 'variable'
      and (scope.category_id is null or product.category_id = scope.category_id)
  )
  select item.product_id, item.variant_id, item.category_id, item.product_name, item.variant_name,
    item.sku, item.barcode, item.price_minor, item.unit
  from saleable_items item
  where item.search_term is null or lower(item.barcode) = item.search_term or lower(item.sku) = item.search_term
    or lower(item.product_name) like '%' || item.search_term || '%'
    or lower(coalesce(item.variant_name, '')) like '%' || item.search_term || '%'
  order by case when lower(item.barcode) = item.search_term then 0 when lower(item.sku) = item.search_term then 1 when lower(item.product_name) = item.search_term or lower(coalesce(item.variant_name, '')) = item.search_term then 2 else 3 end,
    item.product_name, item.variant_name nulls first
  limit coalesce((select result_limit from scope), 0)
  offset coalesce((select result_offset from scope), 0);
$$;

alter table public.product_units enable row level security;
alter table public.product_components enable row level security;

create policy product_units_select_member on public.product_units for select
using ((select private.is_organization_member(organization_id)));
create policy product_units_insert_authorized on public.product_units for insert
with check ((select private.has_permission(organization_id, 'products.manage')));
create policy product_units_update_authorized on public.product_units for update
using ((select private.has_permission(organization_id, 'products.manage')))
with check ((select private.has_permission(organization_id, 'products.manage')));
create policy product_units_delete_authorized on public.product_units for delete
using ((select private.has_permission(organization_id, 'products.manage')));

create policy product_components_select_member on public.product_components for select
using ((select private.is_organization_member(organization_id)));
create policy product_components_insert_authorized on public.product_components for insert
with check ((select private.has_permission(organization_id, 'products.manage')));
create policy product_components_update_authorized on public.product_components for update
using ((select private.has_permission(organization_id, 'products.manage')))
with check ((select private.has_permission(organization_id, 'products.manage')));
create policy product_components_delete_authorized on public.product_components for delete
using ((select private.has_permission(organization_id, 'products.manage')));

revoke all on public.product_units, public.product_components from public, anon, service_role;
grant select, insert, update, delete on public.product_units, public.product_components to authenticated;
grant select (image_url, is_variable_price, allow_fractional_quantity) on public.products to authenticated;
grant update (image_url, is_variable_price, allow_fractional_quantity) on public.products to authenticated;
grant select (price_override_minor, low_stock_level) on public.product_store_settings to authenticated;
grant update (price_override_minor, low_stock_level) on public.product_store_settings to authenticated;

comment on table public.product_units is 'Per-product exact conversion factors into the product inventory base unit.';
comment on table public.product_components is 'Composite recipes. A sale must append component inventory movements, never silently mutate stock.';
comment on column public.product_store_settings.price_override_minor is 'Optional simple/composite product price override for this store, in minor currency units.';

commit;
