-- A batch import is deliberately executed inside one database transaction. Any
-- invalid row aborts the complete batch, preventing a partly imported catalog.

begin;

create or replace function private.import_catalog_products_v2(
  target_organization_id uuid,
  target_store_ids uuid[],
  target_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_row record;
  row_number integer;
  row_json jsonb;
  row_name text;
  row_sku text;
  row_barcode text;
  row_category_id uuid;
  row_unit text;
  row_price_minor bigint;
  row_cost_minor bigint;
  row_price_override_minor bigint;
  row_low_stock_level numeric(14, 3);
  row_product_id uuid;
  seen_skus text[] := '{}';
  seen_barcodes text[] := '{}';
  imported_count integer := 0;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  if jsonb_typeof(target_rows) <> 'array'
    or jsonb_array_length(target_rows) not between 1 and 500 then
    raise exception 'Import between 1 and 500 product rows at a time.' using errcode = '22023';
  end if;

  -- Validate every row and its identifiers before inserting anything.
  for import_row in
    select value, ordinality
    from jsonb_array_elements(target_rows) with ordinality
  loop
    row_json := import_row.value;
    row_number := case
      when coalesce(row_json ->> 'row_number', '') ~ '^[1-9][0-9]*$'
        then (row_json ->> 'row_number')::integer
      else import_row.ordinality::integer
    end;
    row_name := btrim(coalesce(row_json ->> 'name', ''));
    row_sku := nullif(upper(btrim(coalesce(row_json ->> 'sku', ''))), '');
    row_barcode := nullif(btrim(coalesce(row_json ->> 'barcode', '')), '');
    row_unit := lower(btrim(coalesce(row_json ->> 'unit', 'each')));

    if jsonb_typeof(row_json) <> 'object' then
      raise exception 'CSV row % must be an object.', row_number using errcode = '22023';
    end if;
    if char_length(row_name) not between 1 and 160 then
      raise exception 'CSV row % needs a product name of at most 160 characters.', row_number using errcode = '22023';
    end if;
    if char_length(coalesce(row_json ->> 'description', '')) > 2000 then
      raise exception 'CSV row % has a description longer than 2,000 characters.', row_number using errcode = '22023';
    end if;
    if row_sku is not null and row_sku !~ '^[A-Z0-9][A-Z0-9._-]{0,63}$' then
      raise exception 'CSV row % has an invalid SKU.', row_number using errcode = '22023';
    end if;
    if row_barcode is not null and row_barcode !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' then
      raise exception 'CSV row % has an invalid barcode.', row_number using errcode = '22023';
    end if;
    if char_length(row_unit) not between 1 and 24 or row_unit !~ '^[a-z][a-z0-9 _-]*$' then
      raise exception 'CSV row % has an invalid base unit.', row_number using errcode = '22023';
    end if;
    if jsonb_typeof(row_json -> 'track_inventory') <> 'boolean'
      or jsonb_typeof(row_json -> 'is_variable_price') <> 'boolean'
      or jsonb_typeof(row_json -> 'allow_fractional_quantity') <> 'boolean' then
      raise exception 'CSV row % has invalid yes/no values.', row_number using errcode = '22023';
    end if;
    if coalesce(row_json ->> 'price_minor', '') !~ '^\d{1,10}$'
      or coalesce(row_json ->> 'cost_minor', '') !~ '^\d{1,10}$' then
      raise exception 'CSV row % has an invalid price or cost.', row_number using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(row_json ->> 'image_url', '')), '') is not null
      and btrim(row_json ->> 'image_url') !~* '^https?://' then
      raise exception 'CSV row % has an invalid image URL.', row_number using errcode = '22023';
    end if;
    if jsonb_typeof(row_json -> 'price_override_minor') not in ('number', 'null')
      or jsonb_typeof(row_json -> 'low_stock_level') not in ('number', 'null') then
      raise exception 'CSV row % has invalid store price or low-stock data.', row_number using errcode = '22023';
    end if;
    if jsonb_typeof(row_json -> 'price_override_minor') = 'number'
      and row_json ->> 'price_override_minor' !~ '^\d{1,10}$' then
      raise exception 'CSV row % has an invalid store price.', row_number using errcode = '22023';
    end if;
    if jsonb_typeof(row_json -> 'low_stock_level') = 'number'
      and row_json ->> 'low_stock_level' !~ '^\d{1,8}(\.\d{1,3})?$' then
      raise exception 'CSV row % has an invalid low-stock level.', row_number using errcode = '22023';
    end if;

    if nullif(row_json ->> 'category_id', '') is not null then
      if row_json ->> 'category_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not exists (
          select 1
          from public.categories category
          where category.id = (row_json ->> 'category_id')::uuid
            and category.organization_id = target_organization_id
            and not category.is_archived
        ) then
        raise exception 'CSV row % references an unavailable category.', row_number using errcode = '23503';
      end if;
    end if;

    if row_sku is not null and row_sku = any(seen_skus) then
      raise exception 'CSV row % repeats a SKU in this file.', row_number using errcode = '23505';
    end if;
    if row_barcode is not null and row_barcode = any(seen_barcodes) then
      raise exception 'CSV row % repeats a barcode in this file.', row_number using errcode = '23505';
    end if;
    if row_sku is not null then seen_skus := array_append(seen_skus, row_sku); end if;
    if row_barcode is not null then seen_barcodes := array_append(seen_barcodes, row_barcode); end if;
  end loop;

  for import_row in
    select value, ordinality
    from jsonb_array_elements(target_rows) with ordinality
  loop
    row_json := import_row.value;
    row_category_id := nullif(row_json ->> 'category_id', '')::uuid;
    row_price_minor := (row_json ->> 'price_minor')::bigint;
    row_cost_minor := (row_json ->> 'cost_minor')::bigint;
    row_price_override_minor := case
      when jsonb_typeof(row_json -> 'price_override_minor') = 'number'
        then (row_json ->> 'price_override_minor')::bigint
      else null
    end;
    row_low_stock_level := case
      when jsonb_typeof(row_json -> 'low_stock_level') = 'number'
        then (row_json ->> 'low_stock_level')::numeric(14, 3)
      else null
    end;

    row_product_id := private.create_catalog_product_v2(
      target_organization_id,
      row_category_id,
      btrim(row_json ->> 'name'),
      coalesce(row_json ->> 'description', ''),
      'simple',
      coalesce(row_json ->> 'sku', ''),
      coalesce(row_json ->> 'barcode', ''),
      row_price_minor,
      row_cost_minor,
      (row_json ->> 'track_inventory')::boolean,
      coalesce(row_json ->> 'unit', 'each'),
      target_store_ids,
      '[]'::jsonb,
      coalesce(row_json ->> 'image_url', ''),
      (row_json ->> 'is_variable_price')::boolean,
      (row_json ->> 'allow_fractional_quantity')::boolean
    );

    if row_price_override_minor is not null or row_low_stock_level is not null then
      update public.product_store_settings setting
      set price_override_minor = row_price_override_minor,
          low_stock_level = row_low_stock_level
      where setting.organization_id = target_organization_id
        and setting.product_id = row_product_id
        and setting.store_id = any(target_store_ids);
    end if;

    imported_count := imported_count + 1;
  end loop;

  return imported_count;
end;
$$;

create or replace function public.import_catalog_products_v2(
  target_organization_id uuid,
  target_store_ids uuid[],
  target_rows jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.import_catalog_products_v2(
    target_organization_id,
    target_store_ids,
    target_rows
  );
$$;

revoke execute on function private.import_catalog_products_v2(uuid, uuid[], jsonb)
from public, anon, authenticated, service_role;
revoke execute on function public.import_catalog_products_v2(uuid, uuid[], jsonb)
from public, anon, service_role;
grant execute on function private.import_catalog_products_v2(uuid, uuid[], jsonb) to authenticated;
grant execute on function public.import_catalog_products_v2(uuid, uuid[], jsonb) to authenticated;

comment on function public.import_catalog_products_v2(uuid, uuid[], jsonb)
is 'Atomically imports up to 500 validated simple catalog products. Any invalid row rolls back the full batch.';

commit;
