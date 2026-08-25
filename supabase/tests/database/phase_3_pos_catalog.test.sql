begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '77777777-7777-4777-8777-777777777777',
    'pos-owner@tindio.test',
    '{"full_name":"POS Owner"}'::jsonb
  ),
  (
    '88888888-8888-4888-8888-888888888888',
    'pos-other-owner@tindio.test',
    '{"full_name":"Other POS Owner"}'::jsonb
  ),
  (
    '99999999-9999-4999-8999-999999999999',
    'pos-cashier@tindio.test',
    '{"full_name":"POS Cashier"}'::jsonb
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'pos-unassigned@tindio.test',
    '{"full_name":"Unassigned Cashier"}'::jsonb
  );

create temporary table pos_test_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  simple_product_id uuid,
  variable_product_id uuid
);

grant select, insert, update on table pos_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';

insert into pos_test_context (label, organization_id, store_id, register_id)
select 'pos', organization_id, store_id, register_id
from public.bootstrap_organization(
  'POS Test Retail',
  'POS Main',
  'POS Counter'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';

insert into pos_test_context (label, organization_id, store_id, register_id)
select 'other', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Other POS Retail',
  'Other POS Main',
  'Other POS Counter'
);

reset role;

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '99999999-9999-4999-8999-999999999999', 'POS-CASH-001', 'Cashier'
from pos_test_context
where label = 'pos';

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = '99999999-9999-4999-8999-999999999999';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join pos_test_context context
  on context.label = 'pos'
 and context.organization_id = employee.organization_id
where employee.profile_id = '99999999-9999-4999-8999-999999999999';

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'POS-CASH-002', 'Unassigned Cashier'
from pos_test_context
where label = 'pos';

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'POS Drinks', 1
  from pos_test_context
  where label = 'pos'
  returning id
)
update pos_test_context
set category_id = (select id from inserted_category)
where label = 'pos';

update pos_test_context
set simple_product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Counter Coffee',
  'POS simple product',
  'simple',
  'POS-COFFEE',
  '480000009001',
  12500,
  4500,
  true,
  'cup',
  array[store_id],
  '[]'::jsonb
)
where label = 'pos';

update pos_test_context
set variable_product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'TINDIO Tee',
  'POS variable product',
  'variable',
  '',
  '',
  0,
  0,
  false,
  'each',
  array[store_id],
  '[
    {
      "name":"Small / Teal",
      "option_values":{},
      "sku":"TEE-S-TEAL",
      "barcode":"480000009002",
      "price_minor":35000,
      "cost_minor":17000,
      "sort_order":0
    },
    {
      "name":"Large / Teal",
      "option_values":{},
      "sku":"TEE-L-TEAL",
      "barcode":"480000009003",
      "price_minor":35000,
      "cost_minor":17000,
      "sort_order":1
    }
  ]'::jsonb
)
where label = 'pos';

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos')
    )
  ),
  3::bigint,
  'owner can browse only saleable simple items and variants'
);

select is(
  (
    select product_name
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos'),
      '480000009001'
    )
  ),
  'Counter Coffee',
  'simple product barcode resolves directly'
);

select is(
  (
    select variant_name
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos'),
      '480000009002'
    )
  ),
  'Small / Teal',
  'variant barcode resolves directly'
);

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos'),
      'teal'
    )
  ),
  2::bigint,
  'text search matches saleable variant names'
);

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos'),
      null,
      (select category_id from pos_test_context where label = 'pos')
    )
  ),
  3::bigint,
  'category filter is applied before returning the POS page'
);

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos'),
      null,
      null,
      0,
      1
    )
  ),
  1::bigint,
  'catalogue search respects the requested page size'
);

select ok(
  pg_get_function_result(
    'public.search_pos_catalog(uuid,uuid,text,uuid,integer,integer)'::regprocedure
  ) not like '%cost%',
  'POS catalogue search does not expose acquisition cost'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos')
    )
  ),
  0::bigint,
  'another organization cannot search this POS catalogue'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos')
    )
  ),
  3::bigint,
  'assigned cashier with sales.create can browse the POS catalogue'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos')
    )
  ),
  0::bigint,
  'cashier without a store assignment cannot browse that store catalogue'
);

select is(
  (
    select count(*)
    from public.search_pos_catalog(
      (select organization_id from pos_test_context where label = 'pos'),
      (select store_id from pos_test_context where label = 'pos'),
      null,
      null,
      0,
      49
    )
  ),
  0::bigint,
  'catalogue search rejects oversized page requests'
);

select * from finish();
rollback;
