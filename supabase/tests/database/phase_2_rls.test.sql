begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '44444444-4444-4444-8444-444444444444',
    'catalog-owner@tindio.test',
    '{"full_name":"Catalog Owner"}'::jsonb
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'other-owner@tindio.test',
    '{"full_name":"Other Owner"}'::jsonb
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    'catalog-cashier@tindio.test',
    '{"full_name":"Catalog Cashier"}'::jsonb
  );

create temporary table catalog_test_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  secondary_store_id uuid,
  register_id uuid not null,
  category_id uuid,
  product_id uuid,
  variable_product_id uuid
);

grant select, insert, update on table catalog_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

insert into catalog_test_context (label, organization_id, store_id, register_id)
select 'catalog', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Catalog Retail',
  'Catalog Main',
  'Catalog Counter'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';

insert into catalog_test_context (label, organization_id, store_id, register_id)
select 'other', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Other Retail',
  'Other Main',
  'Other Counter'
);

reset role;

with inserted_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Catalog Annex', 'ANNEX'
  from catalog_test_context
  where label = 'catalog'
  returning id
)
update catalog_test_context
set secondary_store_id = (select id from inserted_store)
where label = 'catalog';

insert into public.employees (
  organization_id,
  profile_id,
  employee_number,
  job_title
)
select
  context.organization_id,
  '66666666-6666-4666-8666-666666666666',
  'CASHIER-002',
  'Cashier'
from catalog_test_context context
where context.label = 'catalog';

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = '66666666-6666-4666-8666-666666666666';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join catalog_test_context context
  on context.organization_id = employee.organization_id
 and context.label = 'catalog'
where employee.profile_id = '66666666-6666-4666-8666-666666666666';

create or replace function pg_temp.duplicate_identifier_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.create_catalog_product(
    (select organization_id from catalog_test_context where label = 'catalog'),
    (select category_id from catalog_test_context where label = 'catalog'),
    'Ambiguous Scanner Item',
    '',
    'simple',
    '480000000101',
    '',
    100,
    0,
    false,
    'each',
    array[(select store_id from catalog_test_context where label = 'catalog')],
    '[]'::jsonb
  );

  return false;
exception
  when unique_violation then
    return true;
end;
$$;

create or replace function pg_temp.second_opening_stock_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.record_inventory_adjustment(
    (select organization_id from catalog_test_context where label = 'catalog'),
    (select store_id from catalog_test_context where label = 'catalog'),
    (select product_id from catalog_test_context where label = 'catalog'),
    null,
    1,
    'OPENING_STOCK',
    'Duplicate opening stock',
    gen_random_uuid(),
    null
  );

  return false;
exception
  when check_violation then
    return true;
end;
$$;

create or replace function pg_temp.direct_cost_select_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform product.cost_minor
  from public.products product
  limit 1;

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.direct_level_update_is_rejected()
returns boolean
language plpgsql
as $$
begin
  update public.inventory_levels
  set quantity = 999;

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.direct_movement_insert_is_rejected()
returns boolean
language plpgsql
as $$
begin
  insert into public.inventory_movements default values;

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.cashier_category_insert_is_rejected()
returns boolean
language plpgsql
as $$
begin
  insert into public.categories (organization_id, name)
  values (
    (select organization_id from catalog_test_context where label = 'catalog'),
    'Blocked Category'
  );

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.cashier_cost_lookup_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform *
  from public.get_catalog_costs(
    (select organization_id from catalog_test_context where label = 'catalog'),
    null
  );

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.cashier_inventory_adjustment_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.record_inventory_adjustment(
    (select organization_id from catalog_test_context where label = 'catalog'),
    (select store_id from catalog_test_context where label = 'catalog'),
    (select product_id from catalog_test_context where label = 'catalog'),
    null,
    1,
    'ADJUSTMENT',
    'Unauthorized adjustment',
    gen_random_uuid(),
    null
  );

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.cashier_store_setting_insert_is_rejected()
returns boolean
language plpgsql
as $$
begin
  insert into public.product_store_settings (
    organization_id,
    store_id,
    product_id,
    is_available
  )
  select
    organization_id,
    secondary_store_id,
    variable_product_id,
    true
  from catalog_test_context
  where label = 'catalog';

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

with inserted_category as (
  insert into public.categories (
    organization_id,
    name,
    description,
    icon,
    color,
    sort_order
  )
  values (
    (select organization_id from catalog_test_context where label = 'catalog'),
    'Beverages',
    'Hot and cold drinks',
    'cup-soda',
    '#0F766E',
    10
  )
  returning id
)
update catalog_test_context
set category_id = (select id from inserted_category)
where label = 'catalog';

update catalog_test_context
set product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'House Coffee',
  'Freshly brewed coffee',
  'simple',
  'COFFEE-001',
  '480000000001',
  12500,
  4500,
  true,
  'each',
  array[store_id],
  '[]'::jsonb
)
where label = 'catalog';

update catalog_test_context
set variable_product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'TINDIO Shirt',
  'Variant product example',
  'variable',
  '',
  '',
  0,
  0,
  true,
  'each',
  array[store_id],
  '[
    {
      "name":"Small / Black",
      "option_values":{"Size":"Small","Color":"Black"},
      "sku":"TS-S-BLK",
      "barcode":"480000000101",
      "price_minor":120000,
      "cost_minor":70000,
      "sort_order":0
    },
    {
      "name":"Medium / Black",
      "option_values":{"Size":"Medium","Color":"Black"},
      "sku":"TS-M-BLK",
      "barcode":"480000000102",
      "price_minor":120000,
      "cost_minor":70000,
      "sort_order":1
    }
  ]'::jsonb
)
where label = 'catalog';

select public.create_inventory_adjustment_reason(
  (select organization_id from catalog_test_context where label = 'catalog'),
  'OPENING_STOCK',
  'Opening stock',
  'OPENING_STOCK'
);
select public.create_inventory_adjustment_reason(
  (select organization_id from catalog_test_context where label = 'catalog'),
  'ADJUSTMENT',
  'Inventory correction',
  'ADJUSTMENT'
);

select is((select count(*) from public.categories), 1::bigint, 'owner sees their category');
select is((select count(*) from public.products), 2::bigint, 'owner sees both products');
select is((select count(*) from public.product_variants), 2::bigint, 'variable product creates variants');
select is((select count(*) from public.product_store_settings), 2::bigint, 'store availability is created per product');
select is((select count(*) from public.inventory_levels), 3::bigint, 'tracked saleable items receive zero stock projections');
insert into public.product_store_settings (
  organization_id,
  store_id,
  product_id,
  is_available
)
select organization_id, secondary_store_id, product_id, true
from catalog_test_context
where label = 'catalog';
select is(
  (
    select count(*)
    from public.product_store_settings setting
    join catalog_test_context context
      on context.organization_id = setting.organization_id
     and context.secondary_store_id = setting.store_id
     and context.product_id = setting.product_id
    where context.label = 'catalog'
      and setting.is_available
  ),
  1::bigint,
  'owner can make a product available in a store created later'
);
select is(
  (
    select count(*)
    from public.inventory_levels level
    join catalog_test_context context
      on context.organization_id = level.organization_id
     and context.secondary_store_id = level.store_id
     and context.product_id = level.product_id
    where context.label = 'catalog'
  ),
  1::bigint,
  'new tracked store availability initializes a stock projection'
);
select is(
  (
    select count(*)
    from public.get_catalog_costs(
      (select organization_id from catalog_test_context where label = 'catalog'),
      null
    )
  ),
  4::bigint,
  'authorized owner can read product and variant costs'
);

select lives_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, 10.5, 'OPENING_STOCK', 'Initial delivery', gen_random_uuid(), null)$$,
    (select organization_id from catalog_test_context where label = 'catalog'),
    (select store_id from catalog_test_context where label = 'catalog'),
    (select product_id from catalog_test_context where label = 'catalog')
  ),
  'owner can record opening stock'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where product_id = (
      select product_id from catalog_test_context where label = 'catalog'
    )
      and store_id = (
        select store_id from catalog_test_context where label = 'catalog'
      )
  ),
  10.500::numeric,
  'opening stock updates the projection'
);
select lives_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, -2.25, 'ADJUSTMENT', 'Damaged units', gen_random_uuid(), null)$$,
    (select organization_id from catalog_test_context where label = 'catalog'),
    (select store_id from catalog_test_context where label = 'catalog'),
    (select product_id from catalog_test_context where label = 'catalog')
  ),
  'owner can record a signed adjustment'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where product_id = (
      select product_id from catalog_test_context where label = 'catalog'
    )
      and store_id = (
        select store_id from catalog_test_context where label = 'catalog'
      )
  ),
  8.250::numeric,
  'signed adjustment updates the projection exactly'
);
select is(
  (
    select count(*)
    from public.inventory_movements
    where product_id = (
      select product_id from catalog_test_context where label = 'catalog'
    )
      and quantity_after = quantity_before + quantity_delta
  ),
  2::bigint,
  'every stock change has a balanced append-only movement'
);
select ok(pg_temp.second_opening_stock_is_rejected(), 'opening stock cannot be recorded twice');
select ok(pg_temp.duplicate_identifier_is_rejected(), 'SKU and barcode identifiers cannot be ambiguous');
select ok(pg_temp.direct_cost_select_is_rejected(), 'cost cannot be selected directly');
select ok(pg_temp.direct_level_update_is_rejected(), 'stock projection cannot be updated directly');
select ok(pg_temp.direct_movement_insert_is_rejected(), 'ledger rows cannot be inserted directly');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';

select is((select count(*) from public.products), 0::bigint, 'other organization cannot read catalogue products');
select is((select count(*) from public.inventory_levels), 0::bigint, 'other organization cannot read stock levels');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';

select is((select count(*) from public.products), 2::bigint, 'cashier can read their organization catalogue');
select ok(pg_temp.cashier_category_insert_is_rejected(), 'cashier cannot create categories');
select ok(pg_temp.cashier_cost_lookup_is_rejected(), 'cashier cannot read product costs');
select ok(pg_temp.cashier_inventory_adjustment_is_rejected(), 'cashier cannot adjust inventory');
select ok(pg_temp.cashier_store_setting_insert_is_rejected(), 'cashier cannot add store availability');

select * from finish();
rollback;
