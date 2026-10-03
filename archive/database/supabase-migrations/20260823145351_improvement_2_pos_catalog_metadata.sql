begin;

drop function public.search_pos_catalog(uuid, uuid, text, uuid, integer, integer);

create function public.search_pos_catalog(
  target_organization_id uuid,
  target_store_id uuid,
  target_query text default null,
  target_category_id uuid default null,
  target_offset integer default 0,
  target_limit integer default 24
)
returns table (
  product_id uuid,
  variant_id uuid,
  category_id uuid,
  product_name text,
  variant_name text,
  sku text,
  barcode text,
  price_minor bigint,
  unit text,
  is_variable_price boolean,
  allow_fractional_quantity boolean
)
language sql
stable
set search_path = ''
as $$
  with scope as (
    select target_organization_id organization_id, target_store_id store_id,
      nullif(lower(btrim(coalesce(target_query, ''))), '') search_term,
      target_category_id category_id, target_offset result_offset, target_limit result_limit
    where target_offset >= 0 and target_limit between 1 and 48
      and (select auth.uid()) is not null
      and (select private.has_permission(target_organization_id, 'sales.create'))
      and exists (
        select 1 from public.employees employee
        join public.employee_stores employee_store
          on employee_store.employee_id = employee.id
         and employee_store.organization_id = employee.organization_id
        join public.stores store
          on store.id = employee_store.store_id
         and store.organization_id = employee_store.organization_id
        where employee.organization_id = target_organization_id
          and employee.profile_id = (select auth.uid())
          and employee.status = 'active'
          and employee_store.store_id = target_store_id
          and store.is_active
      )
  ), saleable_items as (
    select product.id product_id, null::uuid variant_id, product.category_id,
      product.name product_name, null::text variant_name, product.sku, product.barcode,
      coalesce(setting.price_override_minor, product.price_minor) price_minor, product.unit,
      product.is_variable_price, product.allow_fractional_quantity,
      scope.search_term, scope.result_offset, scope.result_limit
    from scope
    join public.product_store_settings setting
      on setting.organization_id = scope.organization_id
     and setting.store_id = scope.store_id
     and setting.is_available
    join public.products product
      on product.id = setting.product_id
     and product.organization_id = setting.organization_id
    where product.status = 'active'
      and product.product_type = 'simple'
      and (scope.category_id is null or product.category_id = scope.category_id)
    union all
    select product.id, variant.id, product.category_id, product.name, variant.name,
      variant.sku, variant.barcode, variant.price_minor, product.unit,
      false, product.allow_fractional_quantity,
      scope.search_term, scope.result_offset, scope.result_limit
    from scope
    join public.product_store_settings setting
      on setting.organization_id = scope.organization_id
     and setting.store_id = scope.store_id
     and setting.is_available
    join public.products product
      on product.id = setting.product_id
     and product.organization_id = setting.organization_id
    join public.product_variants variant
      on variant.product_id = product.id
     and variant.organization_id = product.organization_id
     and variant.is_active
    where product.status = 'active'
      and product.product_type = 'variable'
      and (scope.category_id is null or product.category_id = scope.category_id)
  )
  select item.product_id, item.variant_id, item.category_id, item.product_name,
    item.variant_name, item.sku, item.barcode, item.price_minor, item.unit,
    item.is_variable_price, item.allow_fractional_quantity
  from saleable_items item
  where item.search_term is null
    or lower(item.barcode) = item.search_term
    or lower(item.sku) = item.search_term
    or lower(item.product_name) like '%' || item.search_term || '%'
    or lower(coalesce(item.variant_name, '')) like '%' || item.search_term || '%'
  order by
    case
      when lower(item.barcode) = item.search_term then 0
      when lower(item.sku) = item.search_term then 1
      when lower(item.product_name) = item.search_term
        or lower(coalesce(item.variant_name, '')) = item.search_term then 2
      else 3
    end,
    item.product_name,
    item.variant_name nulls first
  limit coalesce((select result_limit from scope), 0)
  offset coalesce((select result_offset from scope), 0);
$$;

revoke execute on function public.search_pos_catalog(uuid, uuid, text, uuid, integer, integer)
from public, anon, service_role;
grant execute on function public.search_pos_catalog(uuid, uuid, text, uuid, integer, integer)
to authenticated;

comment on function public.search_pos_catalog(uuid, uuid, text, uuid, integer, integer)
is 'Returns POS saleable items with server-approved variable-price and fractional-quantity configuration.';

notify pgrst, 'reload schema';

commit;
