set local check_function_bodies = off;

create or replace function public.set_catalog_product_store_configuration (
  target_organization_id      uuid,
  target_product_id           uuid,
  target_store_id             uuid,
  target_price_override_minor bigint,
  target_low_stock_level      numeric
)
  returns void
  language plpgsql
  set search_path to ''
  AS $function$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  if not (select private.has_store_read_scope(target_organization_id, target_store_id)) then
    raise exception 'Store access is required to configure this product.' using errcode = '42501';
  end if;

  insert into public.product_store_settings (
    organization_id,
    product_id,
    store_id,
    is_available,
    price_override_minor,
    low_stock_level
  ) values (
    target_organization_id,
    target_product_id,
    target_store_id,
    true,
    target_price_override_minor,
    target_low_stock_level
  )
  on conflict (store_id, product_id) do update
  set is_available = excluded.is_available,
      price_override_minor = excluded.price_override_minor,
      low_stock_level = excluded.low_stock_level;
end;
$function$;

comment on function "public"."set_catalog_product_store_configuration"(uuid, uuid, uuid, bigint, numeric) is 'Persists authorized product store availability, price override, and low-stock settings without widening identifier-column updates. Requires products.manage and authorized store scope.';

revoke all on function "public"."set_catalog_product_store_configuration"(uuid, uuid, uuid, bigint, numeric) from public;

grant execute on function "public"."set_catalog_product_store_configuration"(uuid, uuid, uuid, bigint, numeric) to "authenticated", "postgres";

