begin;

-- Phase 14: serve the Stock & Restock list as a bounded, permission-checked
-- read model. This preserves inventory_levels as the canonical balance while
-- preventing the browser from receiving every product/store position.
create or replace function public.get_inventory_stock_page(
  target_organization_id uuid,
  requested_store_id uuid default null,
  requested_search text default null,
  requested_category_id uuid default null,
  requested_status text default 'all',
  requested_restock_policy text default 'all',
  requested_sort text default 'priority',
  requested_page integer default 1,
  requested_page_size integer default 50
)
returns table (
  level_id uuid,
  store_id uuid,
  store_name text,
  product_id uuid,
  product_name text,
  category_id uuid,
  category_name text,
  variant_id uuid,
  variant_name text,
  sku text,
  barcode text,
  unit text,
  quantity numeric,
  updated_at timestamptz,
  is_available boolean,
  restock_policy text,
  reorder_point numeric,
  average_cost_minor bigint,
  total_count bigint,
  negative_count bigint,
  low_count bigint,
  in_stock_count bigint,
  out_of_stock_count bigint,
  active_product_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_search text := nullif(lower(btrim(coalesce(requested_search, ''))), '');
  normalized_status text := coalesce(nullif(btrim(requested_status), ''), 'all');
  normalized_restock_policy text := coalesce(nullif(btrim(requested_restock_policy), ''), 'all');
  normalized_sort text := coalesce(nullif(btrim(requested_sort), ''), 'priority');
  page_number integer := greatest(coalesce(requested_page, 1), 1);
  page_size integer := least(greatest(coalesce(requested_page_size, 50), 1), 100);
  can_read_cost boolean := false;
  can_manage_reorder boolean := false;
begin
  if (select auth.uid()) is null
    or not (select private.has_any_inventory_capability(
      target_organization_id,
      array[
        'inventory.view',
        'inventory.adjust.create',
        'inventory.adjust.post',
        'inventory.count.create',
        'inventory.count.finalize',
        'inventory.transfer.create',
        'inventory.transfer.send',
        'inventory.transfer.receive'
      ]
    )) then
    raise exception 'Inventory access is required.' using errcode = '42501';
  end if;

  if requested_store_id is not null
    and not (select private.has_store_read_scope(target_organization_id, requested_store_id)) then
    raise exception 'Store access is required to review stock.' using errcode = '42501';
  end if;

  if normalized_status not in ('all', 'attention', 'available', 'in_stock', 'low', 'negative', 'out_of_stock') then
    raise exception 'Choose a valid stock status.' using errcode = '22023';
  end if;
  if normalized_restock_policy not in ('all', 'restock', 'do_not_restock') then
    raise exception 'Choose a valid restock policy.' using errcode = '22023';
  end if;
  if normalized_sort not in ('priority', 'name_asc', 'name_desc', 'quantity_asc', 'quantity_desc', 'updated_desc', 'value_desc') then
    raise exception 'Choose a valid stock sort.' using errcode = '22023';
  end if;

  can_read_cost := (select private.has_permission(target_organization_id, 'products.view_cost'));
  can_manage_reorder := (select private.has_inventory_capability(target_organization_id, 'inventory.manage'));
  if not can_manage_reorder and normalized_status in ('attention', 'low') then
    normalized_status := 'all';
  end if;
  if not can_read_cost and normalized_sort = 'value_desc' then
    normalized_sort := 'priority';
  end if;

  return query
  with scoped_stores as materialized (
    select store.id, store.name
    from public.stores store
    where store.organization_id = target_organization_id
      and store.is_active
      and (requested_store_id is null or store.id = requested_store_id)
      and (select private.has_store_read_scope(target_organization_id, store.id))
  ),
  active_products as materialized (
    select product.id, product.category_id, product.name, product.sku, product.barcode, product.product_type, product.unit
    from public.products product
    where product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
  ),
  active_variants as materialized (
    select variant.id, variant.product_id, variant.name, variant.sku, variant.barcode
    from public.product_variants variant
    where variant.organization_id = target_organization_id
      and variant.is_active
  ),
  level_positions as (
    select
      level.id as level_id,
      store.id as store_id,
      store.name as store_name,
      product.id as product_id,
      product.name as product_name,
      product.category_id,
      category.name as category_name,
      variant.id as variant_id,
      variant.name as variant_name,
      coalesce(variant.sku, product.sku) as sku,
      coalesce(variant.barcode, product.barcode) as barcode,
      product.unit,
      level.quantity,
      level.updated_at,
      coalesce(setting.is_available, false) as is_available,
      coalesce(setting.restock_policy, 'restock') as restock_policy,
      case
        when can_manage_reorder then
          coalesce(
            rule.reorder_point,
            case
              when level.variant_id is null
                and product.product_type = 'simple'
              then setting.low_stock_level
              else null
            end
          )
        else null
      end as reorder_point,
      case when can_read_cost then level.average_cost_minor else null end as average_cost_minor
    from public.inventory_levels level
    join scoped_stores store on store.id = level.store_id
    join active_products product on product.id = level.product_id
    left join active_variants variant
      on variant.id = level.variant_id
     and variant.product_id = product.id
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = target_organization_id
    left join public.product_store_settings setting
      on setting.organization_id = target_organization_id
     and setting.store_id = level.store_id
     and setting.product_id = level.product_id
    left join public.inventory_replenishment_rules rule
      on rule.organization_id = target_organization_id
     and rule.store_id = level.store_id
     and rule.product_id = level.product_id
     and rule.variant_id is not distinct from level.variant_id
    where level.organization_id = target_organization_id
  ),
  uninitialized_simple_positions as (
    select
      null::uuid as level_id,
      store.id as store_id,
      store.name as store_name,
      product.id as product_id,
      product.name as product_name,
      product.category_id,
      category.name as category_name,
      null::uuid as variant_id,
      null::text as variant_name,
      product.sku,
      product.barcode,
      product.unit,
      0::numeric as quantity,
      setting.updated_at,
      setting.is_available,
      setting.restock_policy,
      case
        when can_manage_reorder then
          coalesce(
            rule.reorder_point,
            setting.low_stock_level
          )
        else null
      end as reorder_point,
      null::bigint as average_cost_minor
    from public.product_store_settings setting
    join scoped_stores store on store.id = setting.store_id
    join active_products product
      on product.id = setting.product_id
     and product.product_type = 'simple'
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = target_organization_id
    left join public.inventory_replenishment_rules rule
      on rule.organization_id = target_organization_id
     and rule.store_id = setting.store_id
     and rule.product_id = product.id
     and rule.variant_id is null
    left join public.inventory_levels level
      on level.organization_id = target_organization_id
     and level.store_id = setting.store_id
     and level.product_id = product.id
     and level.variant_id is null
    where setting.organization_id = target_organization_id
      and level.id is null
  ),
  uninitialized_variant_positions as (
    select
      null::uuid as level_id,
      store.id as store_id,
      store.name as store_name,
      product.id as product_id,
      product.name as product_name,
      product.category_id,
      category.name as category_name,
      variant.id as variant_id,
      variant.name as variant_name,
      coalesce(variant.sku, product.sku) as sku,
      coalesce(variant.barcode, product.barcode) as barcode,
      product.unit,
      0::numeric as quantity,
      setting.updated_at,
      setting.is_available,
      setting.restock_policy,
      case when can_manage_reorder then rule.reorder_point else null end as reorder_point,
      null::bigint as average_cost_minor
    from public.product_store_settings setting
    join scoped_stores store on store.id = setting.store_id
    join active_products product
      on product.id = setting.product_id
     and product.product_type = 'variable'
    join active_variants variant on variant.product_id = product.id
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = target_organization_id
    left join public.inventory_replenishment_rules rule
      on rule.organization_id = target_organization_id
     and rule.store_id = setting.store_id
     and rule.product_id = product.id
     and rule.variant_id = variant.id
    left join public.inventory_levels level
      on level.organization_id = target_organization_id
     and level.store_id = setting.store_id
     and level.product_id = product.id
     and level.variant_id = variant.id
    where setting.organization_id = target_organization_id
      and level.id is null
  ),
  positions as materialized (
    select * from level_positions
    union all
    select * from uninitialized_simple_positions
    union all
    select * from uninitialized_variant_positions
  ),
  classified as materialized (
    select
      position.*,
      case
        when position.quantity < 0 then 'negative'
        when position.reorder_point is not null and position.quantity <= position.reorder_point then
          case when position.quantity = 0 then 'out_of_stock' else 'low' end
        when position.quantity = 0 then 'out_of_stock'
        else 'in_stock'
      end as stock_condition
    from positions position
  ),
  filter_base as materialized (
    select *
    from classified position
    where (requested_category_id is null or position.category_id = requested_category_id)
      and (normalized_restock_policy = 'all' or position.restock_policy = normalized_restock_policy)
      and (
        normalized_search is null
        or lower(position.product_name) like '%' || normalized_search || '%'
        or lower(coalesce(position.variant_name, '')) like '%' || normalized_search || '%'
        or lower(coalesce(position.sku, '')) like '%' || normalized_search || '%'
        or lower(coalesce(position.barcode, '')) like '%' || normalized_search || '%'
      )
  ),
  metrics as materialized (
    select
      count(*) filter (where metric_position.stock_condition = 'negative') as negative_count,
      count(*) filter (where metric_position.stock_condition = 'low') as low_count,
      count(*) filter (where metric_position.stock_condition = 'in_stock') as in_stock_count,
      count(*) filter (where metric_position.stock_condition = 'out_of_stock') as out_of_stock_count,
      count(distinct metric_position.product_id) as active_product_count
    from filter_base metric_position
  ),
  filtered as materialized (
    select filter_position.*
    from filter_base filter_position
    where normalized_status = 'all'
      or (normalized_status = 'available' and filter_position.is_available)
      or (
        normalized_status = 'attention'
        and filter_position.stock_condition in ('low', 'negative', 'out_of_stock')
      )
      or filter_position.stock_condition = normalized_status
  ),
  paged as (
    select
      position.*,
      count(*) over () as total_count
    from filtered position
    order by
      case when normalized_sort = 'priority' then
        case position.stock_condition when 'negative' then 0 when 'low' then 1 when 'in_stock' then 2 else 3 end
      end asc,
      case when normalized_sort = 'name_asc' then lower(position.product_name) end asc,
      case when normalized_sort = 'name_desc' then lower(position.product_name) end desc,
      case when normalized_sort = 'quantity_asc' then position.quantity end asc,
      case when normalized_sort = 'quantity_desc' then position.quantity end desc,
      case when normalized_sort = 'updated_desc' then position.updated_at end desc,
      case when normalized_sort = 'value_desc' then coalesce(position.average_cost_minor, 0) * position.quantity end desc,
      lower(position.product_name) asc,
      lower(coalesce(position.variant_name, '')) asc,
      lower(position.store_name) asc,
      position.level_id asc nulls last
    limit page_size
    offset (page_number - 1) * page_size
  )
  select
    position.level_id,
    position.store_id,
    position.store_name,
    position.product_id,
    position.product_name,
    position.category_id,
    position.category_name,
    position.variant_id,
    position.variant_name,
    position.sku,
    position.barcode,
    position.unit,
    position.quantity,
    position.updated_at,
    position.is_available,
    position.restock_policy,
    position.reorder_point,
    position.average_cost_minor,
    position.total_count,
    metrics.negative_count,
    metrics.low_count,
    metrics.in_stock_count,
    metrics.out_of_stock_count,
    metrics.active_product_count
  from paged position
  cross join metrics;
end;
$$;

revoke execute on function public.get_inventory_stock_page(uuid, uuid, text, uuid, text, text, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.get_inventory_stock_page(uuid, uuid, text, uuid, text, text, text, integer, integer)
  to authenticated;

comment on function public.get_inventory_stock_page(uuid, uuid, text, uuid, text, text, text, integer, integer)
is 'Bounded Stock & Restock read model. Canonical replenishment-rule reorder points drive low-stock state, with legacy product_store_settings.low_stock_level used only as read compatibility for simple non-variant positions when no canonical rule exists. Variant positions never inherit the legacy product/store threshold.';

notify pgrst, 'reload schema';

commit;
