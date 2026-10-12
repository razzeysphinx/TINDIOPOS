-- Keep single-product delta reads inside the hardened 48-row catalog page
-- boundary. The original Phase 12 helper requested 10,000 rows from
-- search_pos_catalog, which the later workspace security repair rejects.

begin;

create or replace function public.get_pos_catalog_product_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  access_store_id uuid;
  product_search text;
  catalog jsonb := '[]'::jsonb;
  catalog_page jsonb;
  matching_items jsonb;
  page_offset integer := 0;
  page_limit integer;
begin
  select access.store_id
  into access_store_id
  from private.require_pos_sync_access(
    target_organization_id,
    (current_setting('request.headers', true)::jsonb ->> 'x-tindio-device-id')::uuid
  ) access;

  if access_store_id is null or access_store_id <> target_store_id then
    raise exception 'Store access is required.' using errcode = '42501';
  end if;

  select product.name
  into product_search
  from public.products product
  where product.organization_id = target_organization_id
    and product.id = target_product_id;

  while product_search is not null and page_offset < 10000 loop
    page_limit := least(48, 10000 - page_offset);

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productId', item.product_id,
          'variantId', item.variant_id,
          'categoryId', item.category_id,
          'productName', item.product_name,
          'variantName', item.variant_name,
          'sku', item.sku,
          'barcode', item.barcode,
          'priceMinor', item.price_minor,
          'unit', item.unit,
          'imageUrl', item.image_url,
          'isVariablePrice', item.is_variable_price,
          'allowFractionalQuantity', item.allow_fractional_quantity,
          'hasModifiers', exists (
            select 1
            from public.product_modifier_groups assignment
            where assignment.organization_id = target_organization_id
              and assignment.product_id = item.product_id
          )
        )
      ),
      '[]'::jsonb
    )
    into catalog_page
    from public.search_pos_catalog(
      target_organization_id,
      target_store_id,
      product_search,
      null,
      page_offset,
      page_limit
    ) item;

    select coalesce(jsonb_agg(entry.value), '[]'::jsonb)
    into matching_items
    from jsonb_array_elements(catalog_page) entry(value)
    where entry.value ->> 'productId' = target_product_id::text;

    catalog := catalog || matching_items;

    exit when jsonb_array_length(catalog_page) < page_limit;
    page_offset := page_offset + page_limit;
  end loop;

  return jsonb_build_object(
    'organizationId', target_organization_id,
    'storeId', target_store_id,
    'productId', target_product_id,
    'items', catalog
  );
end;
$$;

comment on function public.get_pos_catalog_product_v2(uuid, uuid, uuid)
is 'Returns one store-scoped product delta while honoring the bounded POS catalog page contract.';

commit;
