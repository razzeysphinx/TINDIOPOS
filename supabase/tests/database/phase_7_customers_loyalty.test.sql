begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

select has_table('public', 'customers', 'customers table exists');
select has_table('public', 'loyalty_programs', 'loyalty programs table exists');
select has_table('public', 'loyalty_transactions', 'loyalty transactions table exists');
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('customers', 'loyalty_programs', 'loyalty_transactions')
      and relation.relrowsecurity
  ),
  3::bigint,
  'RLS is enabled on every Phase 7 table'
);
select ok(to_regprocedure('public.search_pos_customers(uuid,uuid,text,integer)') is not null, 'POS customer lookup exists');
select ok(to_regprocedure('public.get_customer_summary(uuid,uuid)') is not null, 'customer summary routine exists');
select ok(to_regprocedure('public.get_customer_purchase_history(uuid,uuid,integer)') is not null, 'customer purchase history routine exists');
select ok(
  to_regprocedure('public.checkout_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer)') is not null,
  'customer-aware checkout routine exists'
);
select ok(not has_table_privilege('authenticated', 'public.loyalty_transactions', 'insert'), 'callers cannot insert loyalty ledger entries directly');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('71717171-7171-4717-8717-717171717171', 'loyalty-owner@tindio.test', '{"full_name":"Loyalty Owner"}'::jsonb),
  ('72727272-7272-4727-8727-727272727272', 'loyalty-other@tindio.test', '{"full_name":"Other Loyalty Owner"}'::jsonb);

create temporary table loyalty_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  customer_id uuid,
  product_id uuid,
  first_sale_id uuid,
  second_sale_id uuid,
  first_refund_id uuid
);

grant select, insert, update on loyalty_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '71717171-7171-4717-8717-717171717171';

insert into loyalty_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Loyalty Test Retail', 'Loyalty Test Main', 'Loyalty Test Counter');

select ok(
  exists (
    select 1 from public.loyalty_programs
    where organization_id = (select organization_id from loyalty_test_context)
  ),
  'organization bootstrap receives a loyalty program'
);
select ok(
  exists (
    select 1 from public.payment_methods
    where organization_id = (select organization_id from loyalty_test_context)
      and is_loyalty_redemption
      and code = 'LOYALTY'
  ),
  'organization receives an internal loyalty payment method'
);

update public.loyalty_programs
set
  earn_spend_minor = 100,
  earn_points = 1,
  redemption_value_minor = 100,
  minimum_redemption_points = 1
where organization_id = (select organization_id from loyalty_test_context);

with inserted_customer as (
  insert into public.customers (organization_id, full_name, phone, email)
  values (
    (select organization_id from loyalty_test_context),
    'Loyalty Customer',
    '09171234567',
    'customer@tindio.test'
  )
  returning id
)
update loyalty_test_context
set customer_id = inserted_customer.id
from inserted_customer;

select is((select count(*) from public.customers), 1::bigint, 'authorized manager can create a customer');

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, null)$$,
    (select organization_id from loyalty_test_context),
    (select store_id from loyalty_test_context),
    (select register_id from loyalty_test_context)
  ),
  'owner opens a shift before loyalty checkout'
);

update loyalty_test_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Loyalty Test Item',
  'Untracked loyalty item',
  'simple',
  'LOYALTY-ITEM',
  '480000070007',
  10000,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

select is(
  (
    select count(*)
    from public.search_pos_customers(
      (select organization_id from loyalty_test_context),
      (select store_id from loyalty_test_context),
      'Loyalty Customer',
      8
    )
  ),
  1::bigint,
  'assigned cashier can find an active customer from the POS'
);

select lives_ok(
  format(
    $$select public.checkout_sale(%L, %L, %L, '73737373-7373-4737-8737-737373737373', %L::jsonb, %L::jsonb, %L, 0)$$,
    (select organization_id from loyalty_test_context),
    (select store_id from loyalty_test_context),
    (select register_id from loyalty_test_context),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from loyalty_test_context),
      'variant_id', null,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 10000
    )),
    (select customer_id from loyalty_test_context)
  ),
  'customer checkout earns loyalty points'
);

update loyalty_test_context
set first_sale_id = (
  select sale.id from public.sales sale
  where sale.organization_id = (select organization_id from loyalty_test_context)
    and sale.loyalty_points_redeemed = 0
  order by sale.id
  limit 1
);

select is((select customer_id from public.sales where id = (select first_sale_id from loyalty_test_context)), (select customer_id from loyalty_test_context), 'sale records the selected customer');
select is((select loyalty_points_earned from public.sales where id = (select first_sale_id from loyalty_test_context)), 100::integer, 'sale records earned points');
select is(
  (select coalesce(sum(points_delta), 0) from public.loyalty_transactions where customer_id = (select customer_id from loyalty_test_context)),
  100::bigint,
  'customer balance is derived from the earning ledger'
);

select lives_ok(
  format(
    $$select public.checkout_sale(%L, %L, %L, '74747474-7474-4747-8747-747474747474', %L::jsonb, %L::jsonb, %L, 50)$$,
    (select organization_id from loyalty_test_context),
    (select store_id from loyalty_test_context),
    (select register_id from loyalty_test_context),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from loyalty_test_context),
      'variant_id', null,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 5000
    )),
    (select customer_id from loyalty_test_context)
  ),
  'customer checkout redeems valid loyalty points'
);

update loyalty_test_context
set second_sale_id = (
  select sale.id from public.sales sale
  where sale.organization_id = (select organization_id from loyalty_test_context)
    and sale.loyalty_points_redeemed = 50
  order by sale.id
  limit 1
);

select is((select loyalty_redemption_minor from public.sales where id = (select second_sale_id from loyalty_test_context)), 5000::bigint, 'sale records loyalty tender value');
select is((select loyalty_points_redeemed from public.sales where id = (select second_sale_id from loyalty_test_context)), 50::integer, 'sale records redeemed points');
select is(
  (
    select amount_minor from public.payments
    where sale_id = (select second_sale_id from loyalty_test_context)
      and payment_method_code_snapshot = 'LOYALTY'
  ),
  5000::bigint,
  'loyalty redemption is recorded as a non-cash payment tender'
);
select is(
  (
    select coalesce(sum(points_delta), 0) from public.loyalty_transactions
    where customer_id = (select customer_id from loyalty_test_context)
  ),
  100::bigint,
  'earnings and redemption keep the balance ledger-consistent'
);

select ok(
  (
    select was_replayed
    from public.checkout_sale(
      (select organization_id from loyalty_test_context),
      (select store_id from loyalty_test_context),
      (select register_id from loyalty_test_context),
      '74747474-7474-4747-8747-747474747474',
      jsonb_build_array(jsonb_build_object(
        'product_id', (select product_id from loyalty_test_context),
        'variant_id', null,
        'quantity', 1
      )),
      jsonb_build_array(jsonb_build_object(
        'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
        'amount_tendered_minor', 5000
      )),
      (select customer_id from loyalty_test_context),
      50
    )
  ),
  'loyalty checkout replays safely with the same idempotency key'
);
select is(
  (
    select count(*) from public.loyalty_transactions
    where sale_id = (select second_sale_id from loyalty_test_context)
      and entry_type = 'REDEMPTION'
  ),
  1::bigint,
  'replaying checkout does not duplicate the loyalty redemption'
);

create or replace function pg_temp.insufficient_points_are_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_sale(
    (select organization_id from loyalty_test_context),
    (select store_id from loyalty_test_context),
    (select register_id from loyalty_test_context),
    '75757575-7575-4757-8757-757575757575',
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from loyalty_test_context),
      'variant_id', null,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 1
    )),
    (select customer_id from loyalty_test_context),
    101
  );
  return false;
exception
  when check_violation then return true;
end;
$$;

select ok(pg_temp.insufficient_points_are_rejected(), 'redemption cannot exceed the customer point balance');

update loyalty_test_context context
set first_refund_id = refund.refund_id
from public.refund_sale(
  (select organization_id from loyalty_test_context),
  (select first_sale_id from loyalty_test_context),
  (select id from public.payment_methods where code = 'CASH'),
  '76767676-7676-4767-8767-767676767676',
  'Loyalty test return',
  null,
  jsonb_build_array(jsonb_build_object(
    'sale_item_id', (select id from public.sale_items where sale_id = (select first_sale_id from loyalty_test_context)),
    'quantity', 1
  ))
) refund;

select ok((select first_refund_id from loyalty_test_context) is not null, 'refund completes for a loyalty-earning sale');
select is(
  (
    select points_delta from public.loyalty_transactions
    where refund_id = (select first_refund_id from loyalty_test_context)
      and entry_type = 'REFUND_EARN_REVERSAL'
  ),
  (-100)::integer,
  'a completed refund reverses earned loyalty points'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '72727272-7272-4727-8727-727272727272';

select * from public.bootstrap_organization('Other Loyalty Retail', 'Other Loyalty Main', 'Other Loyalty Counter');

select is((select count(*) from public.customers), 0::bigint, 'another organization cannot read customers');
select is((select count(*) from public.loyalty_transactions), 0::bigint, 'another organization cannot read the loyalty ledger');

create or replace function pg_temp.cross_tenant_customer_search_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.search_pos_customers(
    (select organization_id from loyalty_test_context),
    (select store_id from loyalty_test_context),
    null,
    8
  );
  return false;
exception
  when insufficient_privilege then return true;
end;
$$;

select ok(pg_temp.cross_tenant_customer_search_is_rejected(), 'another organization cannot search this POS customer list');

select * from finish();
rollback;
