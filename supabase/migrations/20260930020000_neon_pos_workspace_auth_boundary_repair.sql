-- Post-Phase-26 certification repair.
--
-- Real Neon testing exposed a legacy POS catalog function that still executed
-- direct provider-auth calls as SECURITY INVOKER. Neon Data API external auth is
-- intentionally consumed through TINDIO's provider-neutral SECURITY DEFINER
-- identity boundary instead.
--
-- This migration changes authorization resolution only.
-- It does not mutate merchant/business rows.

begin;


-- Canonical provider-neutral POS workspace access resolver.
--
-- Preserve:
-- - sales.create
-- - active organization
-- - active employee
-- - active store
-- - explicit store assignment OR organization-wide stores.manage
-- - open shift owned by the current employee
--
-- Remove:
-- - direct provider-auth dependency

create or replace function private.require_pos_workspace_access(
  target_organization_id uuid,
  target_store_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  actor_employee_id uuid;
begin
  if target_organization_id is null
    or target_store_id is null
  then
    raise exception
      'Organization and store are required.'
      using errcode = '22023';
  end if;

  actor_profile_id :=
    private.current_profile_id();

  if actor_profile_id is null
    or not private.has_permission(
      target_organization_id,
      'sales.create'
    )
  then
    raise exception
      'POS access is required.'
      using errcode = '42501';
  end if;

  if not private.has_store_read_scope(
    target_organization_id,
    target_store_id
  )
  then
    raise exception
      'The selected store is not assigned to this employee.'
      using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.organizations organization
    on organization.id =
      employee.organization_id
   and organization.status =
      'active'
  join public.stores store
    on store.organization_id =
      employee.organization_id
   and store.id =
      target_store_id
   and store.is_active
  where employee.organization_id =
      target_organization_id
    and employee.profile_id =
      actor_profile_id
    and employee.status =
      'active'
  order by
    employee.created_at,
    employee.id
  limit 1;

  if actor_employee_id is null
  then
    raise exception
      'An active employee is required for this POS workspace.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.shifts shift
    where shift.organization_id =
        target_organization_id
      and shift.store_id =
        target_store_id
      and shift.opened_by_employee_id =
        actor_employee_id
      and shift.status =
        'open'
  )
  then
    raise exception
      'Open a register shift before using the POS workspace.'
      using errcode = '42501';
  end if;

  return actor_employee_id;
end;
$$;


-- Provider-neutral active drawer predicate.
create or replace function private.has_active_pos_shift_access(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    target_organization_id is not null
    and target_store_id is not null
    and target_register_id is not null

    and private.current_profile_id()
      is not null

    and private.has_permission(
      target_organization_id,
      'sales.create'
    )

    and private.has_store_read_scope(
      target_organization_id,
      target_store_id
    )

    and exists (
      select 1
      from public.employees employee
      join public.stores store
        on store.organization_id =
          employee.organization_id
       and store.id =
          target_store_id
       and store.is_active
      join public.registers register
        on register.organization_id =
          employee.organization_id
       and register.id =
          target_register_id
       and register.store_id =
          target_store_id
       and register.is_active
      join public.shifts shift
        on shift.organization_id =
          employee.organization_id
       and shift.store_id =
          target_store_id
       and shift.register_id =
          target_register_id
       and shift.opened_by_employee_id =
          employee.id
       and shift.status =
          'open'
      where employee.organization_id =
          target_organization_id
        and employee.profile_id =
          private.current_profile_id()
        and employee.status =
          'active'
    ),

    false
  );
$$;


-- Provider-neutral active drawer resolver.
create or replace function private.require_active_pos_shift(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  actor_employee_id uuid;
  active_shift_id uuid;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
  then
    raise exception
      'A store and register are required for POS activity.'
      using errcode = '23514';
  end if;

  actor_profile_id :=
    private.current_profile_id();

  if actor_profile_id is null
    or not private.has_permission(
      target_organization_id,
      'sales.create'
    )
  then
    raise exception
      'Sales permission is required.'
      using errcode = '42501';
  end if;

  if not private.has_store_read_scope(
    target_organization_id,
    target_store_id
  )
  then
    raise exception
      'An active employee assignment, store, and register are required.'
      using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.stores store
    on store.organization_id =
      employee.organization_id
   and store.id =
      target_store_id
   and store.is_active
  join public.registers register
    on register.organization_id =
      employee.organization_id
   and register.id =
      target_register_id
   and register.store_id =
      target_store_id
   and register.is_active
  where employee.organization_id =
      target_organization_id
    and employee.profile_id =
      actor_profile_id
    and employee.status =
      'active'
  order by
    employee.created_at,
    employee.id
  limit 1
  for key share
  of employee, store, register;

  if actor_employee_id is null
  then
    raise exception
      'An active employee assignment, store, and register are required.'
      using errcode = '42501';
  end if;

  select shift.id
  into active_shift_id
  from public.shifts shift
  where shift.organization_id =
      target_organization_id
    and shift.store_id =
      target_store_id
    and shift.register_id =
      target_register_id
    and shift.opened_by_employee_id =
      actor_employee_id
    and shift.status =
      'open'
  for update;

  if active_shift_id is null
  then
    raise exception
      'Open your register shift before using transactional POS features.'
      using errcode = '42501';
  end if;

  return actor_employee_id;
end;
$$;


-- Critical certification repair:
--
-- The legacy web POS calls this RPC directly.
-- It must not execute direct provider-auth calls as the authenticated role.
--
-- SECURITY DEFINER is safe here because:
-- 1. the function accepts only organization/store/search/category/page input;
-- 2. provider-neutral sales permission is checked;
-- 3. provider-neutral store scope is checked;
-- 4. an owned open shift is required;
-- 5. only saleable catalog projection data is returned;
-- 6. no write occurs.

create or replace function public.search_pos_catalog(
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_term text :=
    nullif(
      lower(
        btrim(
          coalesce(
            target_query,
            ''
          )
        )
      ),
      ''
    );
begin
  if target_offset < 0
    or target_limit not between 1 and 48
  then
    raise exception
      'Invalid POS catalog page.'
      using errcode = '22023';
  end if;

  perform private.require_pos_workspace_access(
    target_organization_id,
    target_store_id
  );

  return query
  with saleable_items as (
    select
      product.id as product_id,
      null::uuid as variant_id,
      product.category_id,
      product.name as product_name,
      null::text as variant_name,
      product.sku,
      product.barcode,
      coalesce(
        setting.price_override_minor,
        product.price_minor
      ) as price_minor,
      product.unit,
      product.image_url,
      product.is_variable_price,
      product.allow_fractional_quantity

    from public.product_store_settings setting

    join public.products product
      on product.id =
        setting.product_id
     and product.organization_id =
        setting.organization_id

    where setting.organization_id =
        target_organization_id
      and setting.store_id =
        target_store_id
      and setting.is_available
      and product.status =
        'active'
      and product.product_type in (
        'simple',
        'composite'
      )
      and (
        target_category_id is null
        or product.category_id =
          target_category_id
      )

    union all

    select
      product.id,
      variant.id,
      product.category_id,
      product.name,
      variant.name,
      variant.sku,
      variant.barcode,
      variant.price_minor,
      product.unit,
      product.image_url,
      false,
      product.allow_fractional_quantity

    from public.product_store_settings setting

    join public.products product
      on product.id =
        setting.product_id
     and product.organization_id =
        setting.organization_id

    join public.product_variants variant
      on variant.product_id =
        product.id
     and variant.organization_id =
        product.organization_id
     and variant.is_active

    where setting.organization_id =
        target_organization_id
      and setting.store_id =
        target_store_id
      and setting.is_available
      and product.status =
        'active'
      and product.product_type =
        'variable'
      and (
        target_category_id is null
        or product.category_id =
          target_category_id
      )
  )

  select
    item.product_id,
    item.variant_id,
    item.category_id,
    item.product_name,
    item.variant_name,
    item.sku,
    item.barcode,
    item.price_minor,
    item.unit,
    item.image_url,
    item.is_variable_price,
    item.allow_fractional_quantity

  from saleable_items item

  where search_term is null
    or lower(
      coalesce(
        item.barcode,
        ''
      )
    ) = search_term
    or lower(
      coalesce(
        item.sku,
        ''
      )
    ) = search_term
    or lower(
      item.product_name
    ) like '%' || search_term || '%'
    or lower(
      coalesce(
        item.variant_name,
        ''
      )
    ) like '%' || search_term || '%'

  order by
    case
      when lower(
        coalesce(
          item.barcode,
          ''
        )
      ) = search_term
      then 0

      when lower(
        coalesce(
          item.sku,
          ''
        )
      ) = search_term
      then 1

      when lower(
        item.product_name
      ) = search_term
        or lower(
          coalesce(
            item.variant_name,
            ''
          )
        ) = search_term
      then 2

      else 3
    end,

    item.product_name,
    item.variant_name nulls first

  limit target_limit
  offset target_offset;
end;
$$;


revoke execute
on function private.require_pos_workspace_access(
  uuid,
  uuid
)
from
  public,
  anon,
  authenticated,
  service_role;

revoke execute
on function private.has_active_pos_shift_access(
  uuid,
  uuid,
  uuid
)
from
  public,
  anon,
  authenticated,
  service_role;

revoke execute
on function private.require_active_pos_shift(
  uuid,
  uuid,
  uuid
)
from
  public,
  anon,
  authenticated,
  service_role;

revoke all
on function public.search_pos_catalog(
  uuid,
  uuid,
  text,
  uuid,
  integer,
  integer
)
from
  public,
  anon,
  service_role;

grant execute
on function public.search_pos_catalog(
  uuid,
  uuid,
  text,
  uuid,
  integer,
  integer
)
to authenticated;


comment on function
  public.search_pos_catalog(
    uuid,
    uuid,
    text,
    uuid,
    integer,
    integer
  )
is
'Provider-neutral legacy web POS catalog boundary. Uses TINDIO identity/store/shift authorization and no longer requires authenticated-role access to the provider-owned auth schema.';


notify pgrst, 'reload schema';

commit;
