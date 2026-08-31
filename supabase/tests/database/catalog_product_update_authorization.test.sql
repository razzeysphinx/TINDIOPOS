begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('28282828-2828-4828-8828-282828282828', 'catalog-update-owner@tindio.test', '{"full_name":"Catalog Update Owner"}'::jsonb),
  ('29292929-2929-4929-8929-292929292929', 'catalog-update-unapproved@tindio.test', '{"full_name":"Catalog Update Unapproved"}'::jsonb),
  ('30303030-3030-4030-8030-303030303030', 'catalog-update-store-manager@tindio.test', '{"full_name":"Catalog Update Store Manager"}'::jsonb);

create temporary table catalog_update_context (
  organization_id uuid not null,
  store_id uuid not null,
  secondary_store_id uuid,
  product_id uuid
);

grant select, insert, update on table catalog_update_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '28282828-2828-4828-8828-282828282828';

insert into catalog_update_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization(
  'Catalog Update Authorization',
  'Catalog Update Main',
  'Catalog Update Counter'
);

update catalog_update_context
set product_id = public.create_catalog_product_v2(
  organization_id,
  null,
  'Original catalog product',
  '',
  'simple',
  'CATALOG-UPDATE-1',
  '480000002828',
  100,
  40,
  false,
  'each',
  array[store_id],
  '[]'::jsonb,
  '',
  false,
  false
);

reset role;

with inserted_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Catalog Update Secondary', 'CAT-UPD-2'
  from catalog_update_context
  returning id
)
update catalog_update_context
set secondary_store_id = (select id from inserted_store);

with inserted_employee as (
  insert into public.employees (
    organization_id,
    profile_id,
    employee_number,
    job_title
  )
  select
    organization_id,
    '30303030-3030-4030-8030-303030303030',
    'CAT-SCOPE-1',
    'Scoped catalog manager'
  from catalog_update_context
  returning id, organization_id
), assigned_role as (
  insert into public.employee_roles (organization_id, employee_id, role_id)
  select
    employee.organization_id,
    employee.id,
    role.id
  from inserted_employee employee
  join public.roles role
    on role.organization_id = employee.organization_id
   and role.code = 'manager'
  returning organization_id, employee_id
)
insert into public.employee_stores (organization_id, employee_id, store_id)
select assignment.organization_id, assignment.employee_id, context.store_id
from assigned_role assignment
cross join catalog_update_context context;

set local role authenticated;
set local request.jwt.claim.sub = '28282828-2828-4828-8828-282828282828';

select ok(
  to_regprocedure('public.update_catalog_product_v2(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean)') is not null,
  'the catalog product update routine exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.update_catalog_product_v2(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean)',
    'EXECUTE'
  ),
  'authenticated callers can invoke the guarded catalog update routine'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.update_catalog_product_v2(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean)',
    'EXECUTE'
  ),
  'anonymous callers cannot invoke the catalog update routine'
);

select ok(
  not has_column_privilege('authenticated', 'public.products', 'name', 'UPDATE'),
  'direct product-name updates remain unavailable to authenticated clients'
);

select ok(
  to_regprocedure('public.set_catalog_product_store_availability(uuid,uuid,uuid[])') is not null,
  'the catalog store-availability routine exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.set_catalog_product_store_availability(uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'authenticated callers can invoke the guarded store-availability routine'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_catalog_product_store_availability(uuid,uuid,uuid[])',
    'EXECUTE'
  ),
  'anonymous callers cannot invoke the store-availability routine'
);

select ok(
  to_regprocedure('public.set_catalog_product_store_configuration(uuid,uuid,uuid,bigint,numeric)') is not null,
  'the catalog store-configuration routine exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.set_catalog_product_store_configuration(uuid,uuid,uuid,bigint,numeric)',
    'EXECUTE'
  ),
  'authenticated callers can invoke the guarded store-configuration routine'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_catalog_product_store_configuration(uuid,uuid,uuid,bigint,numeric)',
    'EXECUTE'
  ),
  'anonymous callers cannot invoke the guarded store-configuration routine'
);

select is(
  (
    select count(*)
    from public.permissions permission
    where not exists (
      select 1
      from public.roles role
      join public.role_permissions role_permission
        on role_permission.organization_id = role.organization_id
       and role_permission.role_id = role.id
       and role_permission.permission_code = permission.code
      where role.organization_id = (select organization_id from catalog_update_context)
        and role.is_system
        and role.code = 'owner'
    )
  ),
  0::bigint,
  'the predefined Owner bundle includes every registered capability'
);

reset role;

insert into public.permissions (code, category, name, description)
values (
  'test.catalog_owner_permission_sync',
  'Test',
  'Owner permission synchronization',
  'Temporary database test capability.'
);

select ok(
  exists (
    select 1
    from public.roles role
    join public.role_permissions role_permission
      on role_permission.organization_id = role.organization_id
     and role_permission.role_id = role.id
     and role_permission.permission_code = 'test.catalog_owner_permission_sync'
    where role.organization_id = (select organization_id from catalog_update_context)
      and role.is_system
      and role.code = 'owner'
  ),
  'a newly registered capability is synchronized to existing Owner bundles'
);

set local role authenticated;
set local request.jwt.claim.sub = '28282828-2828-4828-8828-282828282828';

select ok(
  has_column_privilege('authenticated', 'public.product_store_settings', 'price_override_minor', 'INSERT')
    and has_column_privilege('authenticated', 'public.product_store_settings', 'low_stock_level', 'INSERT'),
  'the product-store configuration columns are insertable for capability-checked upserts'
);

select throws_ok(
  format(
    $$insert into public.product_store_settings (
      organization_id, product_id, store_id, is_available, price_override_minor, low_stock_level
    ) values (%L, %L, %L, true, 12500, 3)
    on conflict (store_id, product_id) do update
    set organization_id = excluded.organization_id,
        product_id = excluded.product_id,
        store_id = excluded.store_id,
        is_available = excluded.is_available,
        price_override_minor = excluded.price_override_minor,
        low_stock_level = excluded.low_stock_level$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    (select store_id from catalog_update_context)
  ),
  '42501',
  'permission denied for table product_store_settings',
  'a raw PostgREST-style full-row merge upsert remains denied by identifier-column grants'
);

select lives_ok(
  format(
    $$select public.set_catalog_product_store_configuration(%L, %L, %L, 12500, 3)$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    (select store_id from catalog_update_context)
  ),
  'an Owner can save store price and low-stock settings through the guarded configuration routine'
);

select is(
  (
    select low_stock_level
    from public.product_store_settings
    where product_id = (select product_id from catalog_update_context)
      and store_id = (select store_id from catalog_update_context)
  ),
  3::numeric,
  'the Owner store configuration upsert persists the low-stock setting'
);

select is(
  public.set_catalog_product_store_availability(
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    array[
      (select store_id from catalog_update_context),
      (select secondary_store_id from catalog_update_context)
    ]
  ),
  2,
  'an authorized owner can add a product to another active store'
);

select is(
  (
    select count(*)
    from public.product_store_settings
    where product_id = (select product_id from catalog_update_context)
      and is_available
  ),
  2::bigint,
  'the availability routine enables each selected store'
);

select is(
  public.set_catalog_product_store_availability(
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    array[(select secondary_store_id from catalog_update_context)]
  ),
  1,
  'an authorized owner can remove a product from one store by making it unavailable'
);

select is(
  (
    select is_available
    from public.product_store_settings
    where product_id = (select product_id from catalog_update_context)
      and store_id = (select store_id from catalog_update_context)
  ),
  false,
  'an authorized owner can remove a product from one store by making it unavailable'
);

select is(
  public.update_catalog_product_v2(
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    'Updated catalog product',
    'Updated through the guarded routine',
    null,
    'CATALOG-UPDATE-2',
    '480000002829',
    125,
    50,
    true,
    'Each',
    'https://example.test/catalog-update.png',
    false,
    false
  ),
  'simple',
  'an authorized owner can update product details through the guarded routine'
);

select throws_ok(
  format(
    $$select public.update_catalog_product_v2(%L, %L, 'Updated catalog product', 'Updated through the guarded routine', null, 'CATALOG-UPDATE-2', '480000002829', 125, 50, true, 'box', 'https://example.test/catalog-update.png', false, false)$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context)
  ),
  '23514',
  'The base unit is fixed after product creation to protect inventory and conversion history. Create a new product to use a different unit.',
  'a product base unit cannot be changed after creation'
);

select is(
  (
    select unit
    from public.products
    where id = (select product_id from catalog_update_context)
  ),
  'each',
  'a rejected base-unit change leaves the canonical unit unchanged'
);

reset role;

select is(
  (
    select name
    from public.products
    where id = (select product_id from catalog_update_context)
  ),
  'Updated catalog product',
  'the guarded update persists the requested product details'
);

select is(
  (
    select count(*)
    from public.products
    where id = (select product_id from catalog_update_context)
  ),
  1::bigint,
  'removing store availability does not delete the product master'
);

set local role authenticated;
set local request.jwt.claim.sub = '29292929-2929-4929-8929-292929292929';

select throws_ok(
  format(
    $$select public.update_catalog_product_v2(%L, %L, 'Unauthorized catalog product', '', null, '', '', 0, 0, false, 'each', '', false, false)$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context)
  ),
  '42501',
  'Product management permission is required.',
  'a caller without product-management permission cannot update the product'
);

select throws_ok(
  format(
    $$select public.set_catalog_product_store_availability(%L, %L, '{}'::uuid[])$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context)
  ),
  '42501',
  'Product management permission is required.',
  'a caller without product-management permission cannot change store availability'
);

set local request.jwt.claim.sub = '30303030-3030-4030-8030-303030303030';

select throws_ok(
  format(
    $$insert into public.product_store_settings (organization_id, product_id, store_id, is_available) values (%L, %L, %L, true)$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    (select secondary_store_id from catalog_update_context)
  ),
  '42501',
  'new row violates row-level security policy for table "product_store_settings"',
  'a product manager cannot bypass assigned-store scope through the raw settings API'
);

select throws_ok(
  format(
    $$select public.set_catalog_product_store_availability(%L, %L, array[%L::uuid])$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    (select secondary_store_id from catalog_update_context)
  ),
  '42501',
  'Store access is required to change product availability.',
  'the availability routine rejects an unassigned store for a product manager'
);

select * from finish();
rollback;
