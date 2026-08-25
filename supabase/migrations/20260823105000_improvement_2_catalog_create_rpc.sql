-- Keep the original Phase 2 RPC intact for existing clients, while exposing an
-- atomic creation path for the extended product attributes.

begin;

alter table public.products
  drop constraint products_variable_identifiers,
  add constraint products_variable_identifiers check (
    product_type in ('simple', 'composite') or (sku is null and barcode is null)
  );

create or replace function private.create_catalog_product_v2(
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
  target_allow_fractional_quantity boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_product_id uuid;
begin
  if target_product_type = 'composite'
    and jsonb_array_length(coalesce(target_variants, '[]'::jsonb)) <> 0 then
    raise exception 'Composite products cannot contain saleable variants.' using errcode = '23514';
  end if;

  new_product_id := private.create_catalog_product(
    target_organization_id, target_category_id, target_name, target_description,
    target_product_type, target_sku, target_barcode, target_price_minor,
    target_cost_minor, target_track_inventory, target_unit, target_store_ids, target_variants
  );

  update public.products
  set image_url = nullif(btrim(target_image_url), ''),
      is_variable_price = coalesce(target_is_variable_price, false),
      allow_fractional_quantity = coalesce(target_allow_fractional_quantity, false)
  where id = new_product_id and organization_id = target_organization_id;

  return new_product_id;
end;
$$;

create or replace function public.create_catalog_product_v2(
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
  target_allow_fractional_quantity boolean
)
returns uuid
language sql security invoker set search_path = '' as $$
  select private.create_catalog_product_v2(
    target_organization_id, target_category_id, target_name, target_description,
    target_product_type, target_sku, target_barcode, target_price_minor,
    target_cost_minor, target_track_inventory, target_unit, target_store_ids,
    target_variants, target_image_url, target_is_variable_price,
    target_allow_fractional_quantity
  );
$$;

revoke execute on function private.create_catalog_product_v2(uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb, text, boolean, boolean)
from public, anon, authenticated, service_role;
revoke execute on function public.create_catalog_product_v2(uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb, text, boolean, boolean)
from public, anon, service_role;
grant execute on function private.create_catalog_product_v2(uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb, text, boolean, boolean) to authenticated;
grant execute on function public.create_catalog_product_v2(uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb, text, boolean, boolean) to authenticated;

comment on function public.create_catalog_product_v2(uuid, uuid, text, text, text, text, text, bigint, bigint, boolean, text, uuid[], jsonb, text, boolean, boolean)
is 'Atomically creates a catalog product with image, variable-price, and fractional-quantity configuration.';

commit;
