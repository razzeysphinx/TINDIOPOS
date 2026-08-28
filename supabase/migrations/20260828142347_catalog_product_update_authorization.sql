-- The catalog editor originally attempted a direct table UPDATE, but the
-- products table deliberately exposes only a small set of writable columns to
-- authenticated callers. Keep those column grants restrictive and provide the
-- same reviewed, permission-checked mutation boundary that product creation
-- already uses.

begin;

create or replace function private.update_catalog_product_v2(
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
  target_allow_fractional_quantity boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_product_type text;
  existing_cost_minor bigint;
  effective_cost_minor bigint;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  select product.product_type, product.cost_minor
  into existing_product_type, existing_cost_minor
  from public.products product
  where product.id = target_product_id
    and product.organization_id = target_organization_id;

  if not found then
    raise exception 'The product could not be found.' using errcode = '23503';
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

  -- Acquisition cost is not writable merely because a caller can manage the
  -- product catalogue. The same permission used to read cost is required to
  -- change it, and the old value comes from the authoritative row rather than
  -- the client payload.
  if existing_product_type <> 'variable'
    and target_cost_minor is not null
    and target_cost_minor is distinct from existing_cost_minor
    and not (select private.has_permission(target_organization_id, 'products.view_cost')) then
    raise exception 'Product cost permission is required.' using errcode = '42501';
  end if;

  effective_cost_minor := coalesce(target_cost_minor, existing_cost_minor);

  if existing_product_type = 'variable' then
    update public.products
    set name = target_name,
        description = nullif(target_description, ''),
        category_id = target_category_id,
        track_inventory = target_track_inventory,
        unit = lower(target_unit),
        image_url = nullif(btrim(target_image_url), ''),
        is_variable_price = false,
        allow_fractional_quantity = target_allow_fractional_quantity
    where id = target_product_id
      and organization_id = target_organization_id;
  else
    update public.products
    set name = target_name,
        description = nullif(target_description, ''),
        category_id = target_category_id,
        sku = nullif(target_sku, ''),
        barcode = nullif(target_barcode, ''),
        price_minor = target_price_minor,
        cost_minor = effective_cost_minor,
        track_inventory = target_track_inventory,
        unit = lower(target_unit),
        image_url = nullif(btrim(target_image_url), ''),
        is_variable_price = target_is_variable_price,
        allow_fractional_quantity = target_allow_fractional_quantity
    where id = target_product_id
      and organization_id = target_organization_id;
  end if;

  return existing_product_type;
end;
$$;

create or replace function public.update_catalog_product_v2(
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
  target_allow_fractional_quantity boolean
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.update_catalog_product_v2(
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
$$;

revoke execute on function private.update_catalog_product_v2(uuid, uuid, text, text, uuid, text, text, bigint, bigint, boolean, text, text, boolean, boolean)
from public, anon, authenticated, service_role;
revoke execute on function public.update_catalog_product_v2(uuid, uuid, text, text, uuid, text, text, bigint, bigint, boolean, text, text, boolean, boolean)
from public, anon, authenticated, service_role;

grant execute on function private.update_catalog_product_v2(uuid, uuid, text, text, uuid, text, text, bigint, bigint, boolean, text, text, boolean, boolean)
to authenticated;
grant execute on function public.update_catalog_product_v2(uuid, uuid, text, text, uuid, text, text, bigint, bigint, boolean, text, text, boolean, boolean)
to authenticated;

comment on function public.update_catalog_product_v2(uuid, uuid, text, text, uuid, text, text, bigint, bigint, boolean, text, text, boolean, boolean)
is 'Secure catalog-product edit boundary. Requires products.manage and products.view_cost when cost changes.';

commit;
