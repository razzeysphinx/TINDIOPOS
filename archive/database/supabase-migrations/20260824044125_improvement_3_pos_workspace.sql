begin;

-- Manager-configured, store-scoped quick tiles. The table intentionally stores
-- only catalogue identities; all saleable details and prices are resolved from
-- the authoritative catalogue at read time.
create table public.pos_favorite_tiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  position integer not null,
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_favorite_tiles_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint pos_favorite_tiles_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products (id, organization_id)
    on delete restrict,
  constraint pos_favorite_tiles_variant_product_organization_fkey
    foreign key (variant_id, product_id, organization_id)
    references public.product_variants (id, product_id, organization_id)
    on delete restrict,
  constraint pos_favorite_tiles_created_by_organization_fkey
    foreign key (created_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint pos_favorite_tiles_position_bounds check (position between 1 and 24),
  constraint pos_favorite_tiles_identity_unique
    unique nulls not distinct (organization_id, store_id, product_id, variant_id),
  constraint pos_favorite_tiles_position_unique
    unique (organization_id, store_id, position)
);

create index pos_favorite_tiles_store_position_idx
  on public.pos_favorite_tiles (organization_id, store_id, position);

alter table public.pos_favorite_tiles enable row level security;

create policy pos_favorite_tiles_select_pos_users
on public.pos_favorite_tiles
for select
to authenticated
using (
  (select private.has_permission(organization_id, 'sales.create'))
  and exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = pos_favorite_tiles.organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = pos_favorite_tiles.store_id
  )
);

create policy pos_favorite_tiles_manage_catalog_users
on public.pos_favorite_tiles
for all
to authenticated
using (
  (select private.has_permission(organization_id, 'products.manage'))
  and exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = pos_favorite_tiles.organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = pos_favorite_tiles.store_id
  )
)
with check (
  (select private.has_permission(organization_id, 'products.manage'))
  and exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = pos_favorite_tiles.organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = pos_favorite_tiles.store_id
  )
);

-- POS workspace reads must not depend on the broader receipt-history
-- permission: a cashier can reopen saleable items only while operating an
-- assigned, open shift.
create function private.require_pos_workspace_access(
  target_organization_id uuid,
  target_store_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  if target_organization_id is null or target_store_id is null then
    raise exception 'Organization and store are required.' using errcode = '22023';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'POS access is required.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
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
    and store.is_active;

  if actor_employee_id is null then
    raise exception 'The selected store is not assigned to this employee.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.store_id = target_store_id
      and shift.opened_by_employee_id = actor_employee_id
      and shift.status = 'open'
  ) then
    raise exception 'Open a register shift before using the POS workspace.' using errcode = '42501';
  end if;

  return actor_employee_id;
end;
$$;

create function public.get_pos_favorite_items(
  target_organization_id uuid,
  target_store_id uuid
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
  image_url text,
  is_variable_price boolean,
  allow_fractional_quantity boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_workspace_access(target_organization_id, target_store_id);

  return query
  select
    product.id,
    variant.id,
    product.category_id,
    product.name,
    variant.name,
    coalesce(variant.sku, product.sku),
    coalesce(variant.barcode, product.barcode),
    case
      when variant.id is null then coalesce(setting.price_override_minor, product.price_minor)
      else variant.price_minor
    end,
    product.unit,
    product.image_url,
    case when variant.id is null then product.is_variable_price else false end,
    product.allow_fractional_quantity
  from public.pos_favorite_tiles favorite
  join public.products product
    on product.id = favorite.product_id
   and product.organization_id = favorite.organization_id
  join public.product_store_settings setting
    on setting.organization_id = favorite.organization_id
   and setting.store_id = favorite.store_id
   and setting.product_id = favorite.product_id
   and setting.is_available
  left join public.product_variants variant
    on variant.id = favorite.variant_id
   and variant.product_id = product.id
   and variant.organization_id = product.organization_id
   and variant.is_active
  where favorite.organization_id = target_organization_id
    and favorite.store_id = target_store_id
    and product.status = 'active'
    and (
      (favorite.variant_id is null and product.product_type = 'simple')
      or (favorite.variant_id is not null and product.product_type = 'variable' and variant.id is not null)
    )
  order by favorite.position;
end;
$$;

create function public.get_pos_recent_items(
  target_organization_id uuid,
  target_store_id uuid,
  target_limit integer default 12
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
  image_url text,
  is_variable_price boolean,
  allow_fractional_quantity boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit not between 1 and 24 then
    raise exception 'Recent item limit must be between 1 and 24.' using errcode = '22023';
  end if;

  perform private.require_pos_workspace_access(target_organization_id, target_store_id);

  return query
  with recently_sold as (
    select distinct on (sale_item.product_id, sale_item.variant_id)
      sale_item.product_id,
      sale_item.variant_id,
      sale.completed_at as last_sold_at
    from public.sales sale
    join public.sale_items sale_item
      on sale_item.sale_id = sale.id
     and sale_item.organization_id = sale.organization_id
    where sale.organization_id = target_organization_id
      and sale.store_id = target_store_id
      and sale.status = 'completed'
    order by sale_item.product_id, sale_item.variant_id, sale.completed_at desc
  )
  select
    product.id,
    variant.id,
    product.category_id,
    product.name,
    variant.name,
    coalesce(variant.sku, product.sku),
    coalesce(variant.barcode, product.barcode),
    case
      when variant.id is null then coalesce(setting.price_override_minor, product.price_minor)
      else variant.price_minor
    end,
    product.unit,
    product.image_url,
    case when variant.id is null then product.is_variable_price else false end,
    product.allow_fractional_quantity
  from recently_sold recent
  join public.products product
    on product.id = recent.product_id
   and product.organization_id = target_organization_id
  join public.product_store_settings setting
    on setting.organization_id = target_organization_id
   and setting.store_id = target_store_id
   and setting.product_id = product.id
   and setting.is_available
  left join public.product_variants variant
    on variant.id = recent.variant_id
   and variant.product_id = product.id
   and variant.organization_id = product.organization_id
   and variant.is_active
  where product.status = 'active'
    and (
      (recent.variant_id is null and product.product_type = 'simple')
      or (recent.variant_id is not null and product.product_type = 'variable' and variant.id is not null)
    )
  order by recent.last_sold_at desc, product.name, variant.name nulls first
  limit target_limit;
end;
$$;

create function public.set_pos_favorite_tile(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_is_favorite boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  next_position integer;
begin
  actor_employee_id := private.require_pos_workspace_access(
    target_organization_id,
    target_store_id
  );

  if not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required to configure POS tiles.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.products product
    join public.product_store_settings setting
      on setting.organization_id = product.organization_id
     and setting.store_id = target_store_id
     and setting.product_id = product.id
     and setting.is_available
    left join public.product_variants variant
      on variant.id = target_variant_id
     and variant.product_id = product.id
     and variant.organization_id = product.organization_id
     and variant.is_active
    where product.id = target_product_id
      and product.organization_id = target_organization_id
      and product.status = 'active'
      and (
        (target_variant_id is null and product.product_type = 'simple')
        or (target_variant_id is not null and product.product_type = 'variable' and variant.id is not null)
      )
  ) then
    raise exception 'Only active, saleable products can be pinned to POS favorites.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_organization_id::text || ':' || target_store_id::text));

  if target_is_favorite then
    if not exists (
      select 1
      from public.pos_favorite_tiles favorite
      where favorite.organization_id = target_organization_id
        and favorite.store_id = target_store_id
        and favorite.product_id = target_product_id
        and favorite.variant_id is not distinct from target_variant_id
    ) then
      select candidate.position
      into next_position
      from generate_series(1, 24) as candidate(position)
      where not exists (
        select 1
        from public.pos_favorite_tiles favorite
        where favorite.organization_id = target_organization_id
          and favorite.store_id = target_store_id
          and favorite.position = candidate.position
      )
      order by candidate.position
      limit 1;

      if next_position is null then
        raise exception 'A POS workspace can contain up to 24 favorite tiles.' using errcode = '22023';
      end if;

      insert into public.pos_favorite_tiles (
        organization_id,
        store_id,
        product_id,
        variant_id,
        position,
        created_by_employee_id
      ) values (
        target_organization_id,
        target_store_id,
        target_product_id,
        target_variant_id,
        next_position,
        actor_employee_id
      );
    end if;

    return true;
  end if;

  delete from public.pos_favorite_tiles favorite
  where favorite.organization_id = target_organization_id
    and favorite.store_id = target_store_id
    and favorite.product_id = target_product_id
    and favorite.variant_id is not distinct from target_variant_id;

  return false;
end;
$$;

-- The existing search boundary is extended, rather than duplicated, so every
-- POS view gets the same current store price and availability rules.
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
  image_url text,
  is_variable_price boolean,
  allow_fractional_quantity boolean
)
language sql
stable
security invoker
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
      product.image_url, product.is_variable_price, product.allow_fractional_quantity,
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
      product.image_url, false, product.allow_fractional_quantity,
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
    item.image_url, item.is_variable_price, item.allow_fractional_quantity
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

revoke all on table public.pos_favorite_tiles from public, anon, authenticated, service_role;
revoke execute on function private.require_pos_workspace_access(uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.get_pos_favorite_items(uuid, uuid)
from public, anon, service_role;
revoke execute on function public.get_pos_recent_items(uuid, uuid, integer)
from public, anon, service_role;
revoke execute on function public.set_pos_favorite_tile(uuid, uuid, uuid, uuid, boolean)
from public, anon, service_role;
revoke execute on function public.search_pos_catalog(uuid, uuid, text, uuid, integer, integer)
from public, anon, service_role;

grant execute on function public.get_pos_favorite_items(uuid, uuid) to authenticated;
grant execute on function public.get_pos_recent_items(uuid, uuid, integer) to authenticated;
grant execute on function public.set_pos_favorite_tile(uuid, uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.search_pos_catalog(uuid, uuid, text, uuid, integer, integer)
to authenticated;

comment on table public.pos_favorite_tiles
is 'Manager-configured, store-scoped POS quick tiles; current saleable product values are resolved at read time.';
comment on function public.get_pos_favorite_items(uuid, uuid)
is 'Returns current saleable favorite tiles only for the caller’s assigned, open POS shift.';
comment on function public.get_pos_recent_items(uuid, uuid, integer)
is 'Returns current saleable items most recently completed at the caller’s assigned POS store.';
comment on function public.set_pos_favorite_tile(uuid, uuid, uuid, uuid, boolean)
is 'Pins or unpins one saleable POS item with permission, store, and active-shift checks.';
comment on function public.search_pos_catalog(uuid, uuid, text, uuid, integer, integer)
is 'Returns POS saleable items with current store price, image, manual-price, and fractional-quantity configuration.';

notify pgrst, 'reload schema';

commit;
