begin;

create or replace function private.guard_legacy_low_stock_level()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.low_stock_level is not null then
    raise exception 'Legacy low-stock thresholds are read-only. Configure a replenishment rule instead.' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and new.low_stock_level is distinct from old.low_stock_level then
    raise exception 'Legacy low-stock thresholds are read-only. Configure a replenishment rule instead.' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_legacy_low_stock_level() from public, anon, authenticated, service_role;
drop trigger if exists product_store_settings_guard_legacy_low_stock_level on public.product_store_settings;
create trigger product_store_settings_guard_legacy_low_stock_level
before insert or update of low_stock_level on public.product_store_settings
for each row execute function private.guard_legacy_low_stock_level();
revoke insert (low_stock_level), update (low_stock_level) on public.product_store_settings from authenticated;

create or replace function public.set_catalog_product_store_configuration_v3(
  target_organization_id uuid, target_product_id uuid, target_store_id uuid,
  target_price_override_minor bigint, target_restock_policy text
)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_employee_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;
  if not (select private.has_store_read_scope(target_organization_id, target_store_id)) then
    raise exception 'Store access is required to configure this product.' using errcode = '42501';
  end if;
  if target_price_override_minor is not null and target_price_override_minor < 0 then
    raise exception 'Price override must be non-negative.' using errcode = '22023';
  end if;
  if target_restock_policy not in ('restock', 'do_not_restock') then
    raise exception 'Choose a valid restock intention.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products p where p.id=target_product_id and p.organization_id=target_organization_id)
    or not exists (select 1 from public.stores s where s.id=target_store_id and s.organization_id=target_organization_id and s.is_active) then
    raise exception 'Select an active store and product in this organization.' using errcode = '23503';
  end if;
  actor_employee_id := private.current_employee_id(target_organization_id);
  insert into public.product_store_settings
    (organization_id,product_id,store_id,is_available,price_override_minor,restock_policy)
  values (target_organization_id,target_product_id,target_store_id,true,target_price_override_minor,target_restock_policy)
  on conflict (store_id,product_id) do update
  set is_available=excluded.is_available, price_override_minor=excluded.price_override_minor,
      restock_policy=excluded.restock_policy;
  perform private.write_audit_log(target_organization_id,'PRODUCT_STORE_CONFIGURATION_UPDATED','products.manage',
    actor_employee_id,null,target_store_id,null,null,null,null,
    jsonb_build_object('product_id',target_product_id,'price_override_minor',target_price_override_minor,
      'restock_policy',target_restock_policy,'low_stock_authority','canonical replenishment rule'));
end;
$$;
revoke execute on function public.set_catalog_product_store_configuration_v3(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.set_catalog_product_store_configuration_v3(uuid,uuid,uuid,bigint,text) to authenticated;

create or replace function private.import_catalog_products_v3(target_organization_id uuid,target_store_ids uuid[],target_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  import_row record; row_number integer; row_json jsonb; row_name text; row_sku text; row_barcode text;
  row_category_id uuid; row_unit text; row_price_minor bigint; row_cost_minor bigint;
  row_price_override_minor bigint; row_product_id uuid; seen_skus text[] := '{}'; seen_barcodes text[] := '{}'; imported_count integer := 0;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id,'products.manage')) then raise exception 'Product management permission is required.' using errcode='42501'; end if;
  if jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows) not between 1 and 500 then raise exception 'Import between 1 and 500 product rows at a time.' using errcode='22023'; end if;
  if target_store_ids is null or cardinality(target_store_ids) not between 1 and 100 or cardinality(target_store_ids)<>(select count(distinct id) from unnest(target_store_ids) id) then raise exception 'Choose unique stores for this import.' using errcode='22023'; end if;
  if exists(select 1 from unnest(target_store_ids) id where not private.has_store_read_scope(target_organization_id,id))
    or exists(select 1 from unnest(target_store_ids) id where not exists(select 1 from public.stores s where s.id=id and s.organization_id=target_organization_id and s.is_active)) then raise exception 'Every import store must be active and authorized.' using errcode='42501'; end if;
  for import_row in select value,ordinality from jsonb_array_elements(target_rows) with ordinality loop
    row_json:=import_row.value; row_number:=case when coalesce(row_json->>'row_number','')~'^[1-9][0-9]*$' then (row_json->>'row_number')::integer else import_row.ordinality::integer end;
    row_name:=btrim(coalesce(row_json->>'name','')); row_sku:=nullif(upper(btrim(coalesce(row_json->>'sku',''))),''); row_barcode:=nullif(btrim(coalesce(row_json->>'barcode','')),''); row_unit:=lower(btrim(coalesce(row_json->>'unit','each')));
    if jsonb_typeof(row_json)<>'object' then raise exception 'CSV row % must be an object.',row_number using errcode='22023'; end if;
    if row_json ? 'low_stock_level' then raise exception 'CSV row % contains legacy low_stock_level. Configure replenishment rules in Stock & Restock.',row_number using errcode='55000'; end if;
    if char_length(row_name) not between 1 and 160 then raise exception 'CSV row % needs a product name of at most 160 characters.',row_number using errcode='22023'; end if;
    if char_length(coalesce(row_json->>'description',''))>2000 then raise exception 'CSV row % has a description longer than 2,000 characters.',row_number using errcode='22023'; end if;
    if row_sku is not null and row_sku!~'^[A-Z0-9][A-Z0-9._-]{0,63}$' then raise exception 'CSV row % has an invalid SKU.',row_number using errcode='22023'; end if;
    if row_barcode is not null and row_barcode!~'^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' then raise exception 'CSV row % has an invalid barcode.',row_number using errcode='22023'; end if;
    if char_length(row_unit) not between 1 and 24 or row_unit!~'^[a-z][a-z0-9 _-]*$' then raise exception 'CSV row % has an invalid base unit.',row_number using errcode='22023'; end if;
    if jsonb_typeof(row_json->'track_inventory')<>'boolean' or jsonb_typeof(row_json->'is_variable_price')<>'boolean' or jsonb_typeof(row_json->'allow_fractional_quantity')<>'boolean' then raise exception 'CSV row % has invalid yes/no values.',row_number using errcode='22023'; end if;
    if coalesce(row_json->>'price_minor','')!~'^\d{1,10}$' or coalesce(row_json->>'cost_minor','')!~'^\d{1,10}$' then raise exception 'CSV row % has an invalid price or cost.',row_number using errcode='22023'; end if;
    if nullif(btrim(coalesce(row_json->>'image_url','')),'') is not null and btrim(row_json->>'image_url')!~*'^https?://' then raise exception 'CSV row % has an invalid image URL.',row_number using errcode='22023'; end if;
    if jsonb_typeof(row_json->'price_override_minor') not in ('number','null') then raise exception 'CSV row % has invalid store price data.',row_number using errcode='22023'; end if;
    if jsonb_typeof(row_json->'price_override_minor')='number' and row_json->>'price_override_minor'!~'^\d{1,10}$' then raise exception 'CSV row % has an invalid store price.',row_number using errcode='22023'; end if;
    if nullif(row_json->>'category_id','') is not null and ((row_json->>'category_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists(select 1 from public.categories c where c.id=(row_json->>'category_id')::uuid and c.organization_id=target_organization_id and not c.is_archived)) then raise exception 'CSV row % references an unavailable category.',row_number using errcode='23503'; end if;
    if row_sku is not null and row_sku=any(seen_skus) then raise exception 'CSV row % repeats a SKU in this file.',row_number using errcode='23505'; end if;
    if row_barcode is not null and row_barcode=any(seen_barcodes) then raise exception 'CSV row % repeats a barcode in this file.',row_number using errcode='23505'; end if;
    if row_sku is not null then seen_skus:=array_append(seen_skus,row_sku); end if; if row_barcode is not null then seen_barcodes:=array_append(seen_barcodes,row_barcode); end if;
  end loop;
  for import_row in select value from jsonb_array_elements(target_rows) loop
    row_json:=import_row.value; row_category_id:=nullif(row_json->>'category_id','')::uuid; row_price_minor:=(row_json->>'price_minor')::bigint; row_cost_minor:=(row_json->>'cost_minor')::bigint;
    row_price_override_minor:=case when jsonb_typeof(row_json->'price_override_minor')='number' then (row_json->>'price_override_minor')::bigint else null end;
    row_product_id:=private.create_catalog_product_v2(target_organization_id,row_category_id,btrim(row_json->>'name'),coalesce(row_json->>'description',''),'simple',coalesce(row_json->>'sku',''),coalesce(row_json->>'barcode',''),row_price_minor,row_cost_minor,(row_json->>'track_inventory')::boolean,coalesce(row_json->>'unit','each'),target_store_ids,'[]'::jsonb,coalesce(row_json->>'image_url',''),(row_json->>'is_variable_price')::boolean,(row_json->>'allow_fractional_quantity')::boolean);
    if row_price_override_minor is not null then update public.product_store_settings set price_override_minor=row_price_override_minor where organization_id=target_organization_id and product_id=row_product_id and store_id=any(target_store_ids); end if;
    imported_count:=imported_count+1;
  end loop;
  return imported_count;
end;
$$;
create or replace function public.import_catalog_products_v3(target_organization_id uuid,target_store_ids uuid[],target_rows jsonb)
returns integer language sql security definer set search_path = '' as $$ select private.import_catalog_products_v3(target_organization_id,target_store_ids,target_rows); $$;
revoke execute on function private.import_catalog_products_v3(uuid,uuid[],jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.import_catalog_products_v3(uuid,uuid[],jsonb) from public,anon,authenticated,service_role;
grant execute on function public.import_catalog_products_v3(uuid,uuid[],jsonb) to authenticated;

alter function public.upsert_inventory_replenishment_rule_v2(uuid,uuid,uuid,numeric,numeric,uuid,uuid) security definer;
revoke execute on function private.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric) from public,anon,authenticated,service_role;
drop function public.set_catalog_product_store_configuration(uuid,uuid,uuid,bigint,numeric);
drop function public.set_catalog_product_store_configuration_v2(uuid,uuid,uuid,bigint,numeric,text);
drop function private.set_catalog_product_store_configuration_v2(uuid,uuid,uuid,bigint,numeric,text);
drop function public.import_catalog_products_v2(uuid,uuid[],jsonb);
drop function private.import_catalog_products_v2(uuid,uuid[],jsonb);
comment on column public.product_store_settings.low_stock_level is 'Legacy compatibility fallback only. New low-stock configuration is inventory_replenishment_rules.reorder_point.';
comment on function public.set_catalog_product_store_configuration_v3(uuid,uuid,uuid,bigint,text) is 'Updates price and restock intention without low_stock_level application writes or stock effects.';
comment on function public.import_catalog_products_v3(uuid,uuid[],jsonb) is 'Atomic catalog import without low_stock_level application writes or automatic replenishment documents.';
commit;
