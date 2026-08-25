begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '12121212-1212-4212-8212-121212121212',
    'checkout-owner@tindio.test',
    '{"full_name":"Checkout Owner"}'::jsonb
  ),
  (
    '13131313-1313-4313-8313-131313131313',
    'checkout-other-owner@tindio.test',
    '{"full_name":"Other Checkout Owner"}'::jsonb
  ),
  (
    '14141414-1414-4414-8414-141414141414',
    'checkout-cashier@tindio.test',
    '{"full_name":"Checkout Cashier"}'::jsonb
  );

create temporary table checkout_test_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  simple_product_id uuid,
  variable_product_id uuid,
  variable_variant_id uuid
);

create temporary table checkout_test_result (
  sale_id uuid not null,
  receipt_number bigint not null,
  total_minor bigint not null,
  cash_tendered_minor bigint not null,
  change_minor bigint not null,
  was_replayed boolean not null
);

grant select, insert, update on table checkout_test_context, checkout_test_result
to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '12121212-1212-4212-8212-121212121212';

insert into checkout_test_context (label, organization_id, store_id, register_id)
select 'checkout', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Checkout Test Retail',
  'Checkout Main',
  'Checkout Counter'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '13131313-1313-4313-8313-131313131313';

insert into checkout_test_context (label, organization_id, store_id, register_id)
select 'other', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Other Checkout Retail',
  'Other Checkout Main',
  'Other Checkout Counter'
);

reset role;

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '14141414-1414-4414-8414-141414141414', 'CHECK-CASH-001', 'Cashier'
from checkout_test_context
where label = 'checkout';

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = '14141414-1414-4414-8414-141414141414';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join checkout_test_context context
  on context.organization_id = employee.organization_id
 and context.label = 'checkout'
where employee.profile_id = '14141414-1414-4414-8414-141414141414';

create or replace function pg_temp.insufficient_tender_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_cash_sale(
    (select organization_id from checkout_test_context where label = 'checkout'),
    (select store_id from checkout_test_context where label = 'checkout'),
    (select register_id from checkout_test_context where label = 'checkout'),
    1,
    '17171717-1717-4717-8717-171717171717',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', (select simple_product_id from checkout_test_context where label = 'checkout'),
        'variant_id', null,
        'quantity', 1
      )
    )
  );

  return false;
exception
  when check_violation then
    return true;
end;
$$;

create or replace function pg_temp.idempotency_collision_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_cash_sale(
    (select organization_id from checkout_test_context where label = 'checkout'),
    (select store_id from checkout_test_context where label = 'checkout'),
    (select register_id from checkout_test_context where label = 'checkout'),
    65001,
    '15151515-1515-4515-8515-151515151515',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', (select simple_product_id from checkout_test_context where label = 'checkout'),
        'variant_id', null,
        'quantity', 2
      ),
      jsonb_build_object(
        'product_id', (select variable_product_id from checkout_test_context where label = 'checkout'),
        'variant_id', (select variable_variant_id from checkout_test_context where label = 'checkout'),
        'quantity', 1
      )
    )
  );

  return false;
exception
  when unique_violation then
    return true;
end;
$$;

create or replace function pg_temp.cross_tenant_checkout_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_cash_sale(
    (select organization_id from checkout_test_context where label = 'checkout'),
    (select store_id from checkout_test_context where label = 'checkout'),
    (select register_id from checkout_test_context where label = 'checkout'),
    12500,
    '16161616-1616-4616-8616-161616161616',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', (select simple_product_id from checkout_test_context where label = 'checkout'),
        'variant_id', null,
        'quantity', 1
      )
    )
  );

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.direct_sale_insert_is_rejected()
returns boolean
language plpgsql
as $$
begin
  insert into public.sales default values;
  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '12121212-1212-4212-8212-121212121212';

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'Checkout Drinks', 1
  from checkout_test_context
  where label = 'checkout'
  returning id
)
update checkout_test_context
set category_id = (select id from inserted_category)
where label = 'checkout';

update checkout_test_context
set simple_product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Checkout Coffee',
  'Tracked checkout product',
  'simple',
  'CHECK-COFFEE',
  '480000040001',
  12500,
  4000,
  true,
  'cup',
  array[store_id],
  '[]'::jsonb
)
where label = 'checkout';

update checkout_test_context
set variable_product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Checkout Shirt',
  'Tracked variant checkout product',
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
      "name":"Medium / Teal",
      "option_values":{},
      "sku":"CHECK-SHIRT-M",
      "barcode":"480000040002",
      "price_minor":35000,
      "cost_minor":12000,
      "sort_order":0
    }
  ]'::jsonb
)
where label = 'checkout';

update checkout_test_context context
set variable_variant_id = variant.id
from public.product_variants variant
where variant.organization_id = context.organization_id
  and variant.product_id = context.variable_product_id
  and context.label = 'checkout';

select lives_ok(
  format(
    $$select public.adjust_inventory(%L, %L, %L, null, 10, 'OPENING_STOCK', 'Initial coffee stock')$$,
    (select organization_id from checkout_test_context where label = 'checkout'),
    (select store_id from checkout_test_context where label = 'checkout'),
    (select simple_product_id from checkout_test_context where label = 'checkout')
  ),
  'owner can initialize simple product stock before checkout'
);

select lives_ok(
  format(
    $$select public.adjust_inventory(%L, %L, %L, %L, 5, 'OPENING_STOCK', 'Initial shirt stock')$$,
    (select organization_id from checkout_test_context where label = 'checkout'),
    (select store_id from checkout_test_context where label = 'checkout'),
    (select variable_product_id from checkout_test_context where label = 'checkout'),
    (select variable_variant_id from checkout_test_context where label = 'checkout')
  ),
  'owner can initialize variant stock before checkout'
);

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 10000, 'Checkout opening float')$$,
    (select organization_id from checkout_test_context where label = 'checkout'),
    (select store_id from checkout_test_context where label = 'checkout'),
    (select register_id from checkout_test_context where label = 'checkout')
  ),
  'owner can open a register shift before checkout'
);

insert into checkout_test_result
select *
from public.checkout_cash_sale(
  (select organization_id from checkout_test_context where label = 'checkout'),
  (select store_id from checkout_test_context where label = 'checkout'),
  (select register_id from checkout_test_context where label = 'checkout'),
  65000,
  '15151515-1515-4515-8515-151515151515',
  jsonb_build_array(
    jsonb_build_object(
      'product_id', (select simple_product_id from checkout_test_context where label = 'checkout'),
      'variant_id', null,
      'quantity', 2
    ),
    jsonb_build_object(
      'product_id', (select variable_product_id from checkout_test_context where label = 'checkout'),
      'variant_id', (select variable_variant_id from checkout_test_context where label = 'checkout'),
      'quantity', 1
    )
  )
);

select is(
  (select total_minor from checkout_test_result limit 1),
  60000::bigint,
  'checkout total is calculated from server-side catalogue prices'
);
select is(
  (select cash_tendered_minor from checkout_test_result limit 1),
  65000::bigint,
  'cash tender is recorded in minor units'
);
select is(
  (select change_minor from checkout_test_result limit 1),
  5000::bigint,
  'cash change is calculated in minor units'
);
select ok(
  (select receipt_number > 0 from checkout_test_result limit 1),
  'completed checkout receives a receipt number'
);
select is(
  (
    select count(*)
    from public.sales
    where organization_id = (select organization_id from checkout_test_context where label = 'checkout')
  ),
  1::bigint,
  'checkout creates exactly one completed sale'
);
select is(
  (
    select count(*)
    from public.sale_items
    where sale_id = (select sale_id from checkout_test_result limit 1)
  ),
  2::bigint,
  'checkout creates immutable item snapshots'
);
select is(
  (
    select sum(line_total_minor)
    from public.sale_items
    where sale_id = (select sale_id from checkout_test_result limit 1)
  ),
  60000::numeric,
  'sale item snapshots reconcile to the sale total'
);
select is(
  (
    select amount_tendered_minor - change_given_minor
    from public.payments
    where sale_id = (select sale_id from checkout_test_result limit 1)
  ),
  60000::bigint,
  'cash payment reconciles tender and change to the sale amount'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where store_id = (select store_id from checkout_test_context where label = 'checkout')
      and product_id = (select simple_product_id from checkout_test_context where label = 'checkout')
      and variant_id is null
  ),
  8.000::numeric,
  'checkout deducts tracked simple-product stock'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where store_id = (select store_id from checkout_test_context where label = 'checkout')
      and product_id = (select variable_product_id from checkout_test_context where label = 'checkout')
      and variant_id = (select variable_variant_id from checkout_test_context where label = 'checkout')
  ),
  4.000::numeric,
  'checkout deducts tracked variant stock'
);
select is(
  (
    select count(*)
    from public.inventory_movements
    where source_id = (select sale_id from checkout_test_result limit 1)
      and movement_type = 'SALE'
      and quantity_after = quantity_before + quantity_delta
  ),
  2::bigint,
  'each tracked checkout item receives a balanced SALE ledger movement'
);

insert into checkout_test_result
select *
from public.checkout_cash_sale(
  (select organization_id from checkout_test_context where label = 'checkout'),
  (select store_id from checkout_test_context where label = 'checkout'),
  (select register_id from checkout_test_context where label = 'checkout'),
  65000,
  '15151515-1515-4515-8515-151515151515',
  jsonb_build_array(
    jsonb_build_object(
      'product_id', (select simple_product_id from checkout_test_context where label = 'checkout'),
      'variant_id', null,
      'quantity', 2
    ),
    jsonb_build_object(
      'product_id', (select variable_product_id from checkout_test_context where label = 'checkout'),
      'variant_id', (select variable_variant_id from checkout_test_context where label = 'checkout'),
      'quantity', 1
    )
  )
);

select ok(
  (select bool_or(was_replayed) from checkout_test_result),
  'repeating the same checkout key returns the original completed result'
);
select is(
  (
    select count(*)
    from public.sales
    where organization_id = (select organization_id from checkout_test_context where label = 'checkout')
  ),
  1::bigint,
  'idempotent replay does not create another sale'
);
select is(
  (
    select count(*)
    from public.inventory_movements
    where source_id = (select sale_id from checkout_test_result limit 1)
      and movement_type = 'SALE'
  ),
  2::bigint,
  'idempotent replay does not deduct stock a second time'
);
select ok(pg_temp.insufficient_tender_is_rejected(), 'cash tender below the computed total is rejected');
select ok(pg_temp.idempotency_collision_is_rejected(), 'one checkout key cannot be reused with different payload');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '13131313-1313-4313-8313-131313131313';

select ok(pg_temp.cross_tenant_checkout_is_rejected(), 'another organization cannot charge this store');
select is((select count(*) from public.sales), 0::bigint, 'another organization cannot read checkout sales');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '14141414-1414-4414-8414-141414141414';

select ok(pg_temp.direct_sale_insert_is_rejected(), 'cashier cannot insert sales outside the checkout routine');

select * from finish();
rollback;
