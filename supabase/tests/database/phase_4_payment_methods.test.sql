begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '21212121-2121-4212-8212-212121212121',
  'payments-owner@tindio.test',
  '{"full_name":"Payments Owner"}'::jsonb
);

create temporary table payment_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  product_id uuid,
  custom_method_id uuid
);

create temporary table payment_test_result (
  label text primary key,
  sale_id uuid not null,
  receipt_number bigint not null,
  total_minor bigint not null,
  change_minor bigint not null,
  payment_summary jsonb not null,
  was_replayed boolean not null
);

grant select, insert, update on table payment_test_context, payment_test_result
to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '21212121-2121-4212-8212-212121212121';

insert into payment_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization(
  'Payment Test Retail',
  'Payment Test Main',
  'Payment Test Counter'
);

select is(
  (select count(*) from public.payment_methods),
  6::bigint,
  'a new organization receives five customer payment methods and loyalty tender'
);
select is(
  (select count(*) from public.store_payment_methods),
  6::bigint,
  'a new store receives availability for every default tender'
);

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'Payment Tests', 1
  from payment_test_context
  returning id
)
update payment_test_context
set category_id = (select id from inserted_category);

update payment_test_context
set product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Payment Test Item',
  'Untracked payment test product',
  'simple',
  'PAYMENT-ITEM',
  '480000050001',
  1000,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 1000, 'Payment test opening float')$$,
    (select organization_id from payment_test_context),
    (select store_id from payment_test_context),
    (select register_id from payment_test_context)
  ),
  'owner can open a register shift before payment tests'
);

insert into payment_test_result
select 'card', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '22222222-2222-4222-8222-222222222222',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (
      select id from public.payment_methods where code = 'CARD'
    ),
    'amount_minor', 1000
  ))
) checkout;

select is(
  (select total_minor from payment_test_result where label = 'card'),
  1000::bigint,
  'manual card payment completes a sale'
);
select is(
  (select payment_summary -> 0 ->> 'type' from payment_test_result where label = 'card'),
  'CARD',
  'card payment stores a stable payment-type snapshot'
);

insert into payment_test_result
select 'gcash', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '23232323-2323-4232-8232-232323232323',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where code = 'GCASH'),
    'amount_minor', 1000,
    'reference_number', 'ABC123'
  ))
) checkout;

select is(
  (select payment_summary -> 0 ->> 'reference_number' from payment_test_result where label = 'gcash'),
  'ABC123',
  'GCash reference number is persisted'
);

insert into payment_test_result
select 'maya', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '24242424-2424-4242-8242-242424242424',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where code = 'MAYA'),
    'amount_minor', 1000
  ))
) checkout;

select is(
  (select payment_summary -> 0 ->> 'code' from payment_test_result where label = 'maya'),
  'MAYA',
  'Maya manual payment completes a sale'
);

insert into payment_test_result
select 'transfer', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '25252525-2525-4252-8252-252525252525',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where code = 'BANK_TRANSFER'),
    'amount_minor', 1000,
    'reference_number', 'BANK-101',
    'note', 'Mobile transfer'
  ))
) checkout;

select is(
  (select payment_summary -> 0 ->> 'note' from payment_test_result where label = 'transfer'),
  'Mobile transfer',
  'bank transfer note is persisted'
);

insert into payment_test_result
select 'cash-exact', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '26262626-2626-4262-8262-262626262626',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
    'amount_tendered_minor', 1000
  ))
) checkout;

select is(
  (select change_minor from payment_test_result where label = 'cash-exact'),
  0::bigint,
  'exact cash has no change'
);

insert into payment_test_result
select 'cash-change', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '27272727-2727-4272-8272-272727272727',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
    'amount_tendered_minor', 5000
  ))
) checkout;

select is(
  (select change_minor from payment_test_result where label = 'cash-change'),
  4000::bigint,
  'cash change is calculated without increasing payment revenue'
);
select is(
  (
    select amount_minor
    from public.payments
    where sale_id = (select sale_id from payment_test_result where label = 'cash-change')
  ),
  1000::bigint,
  'cash payment amount stores only the sale portion'
);

insert into payment_test_result
select 'split', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '28282828-2828-4282-8282-282828282828',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(
    jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 400
    ),
    jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'GCASH'),
      'amount_minor', 600
    )
  )
) checkout;

select is(
  (select jsonb_array_length(payment_summary) from payment_test_result where label = 'split'),
  2,
  'split checkout creates two payment records'
);
select is(
  (
    select sum(amount_minor)
    from public.payments
    where sale_id = (select sale_id from payment_test_result where label = 'split')
  ),
  1000::numeric,
  'split payment amounts reconcile to the sale total'
);

create or replace function pg_temp.incomplete_split_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_sale(
    (select organization_id from payment_test_context),
    (select store_id from payment_test_context),
    (select register_id from payment_test_context),
    '29292929-2929-4292-8292-292929292929',
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
    )),
    jsonb_build_array(
      jsonb_build_object(
        'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
        'amount_tendered_minor', 400
      ),
      jsonb_build_object(
        'payment_method_id', (select id from public.payment_methods where code = 'GCASH'),
        'amount_minor', 500
      )
    )
  );
  return false;
exception
  when check_violation then
    return true;
end;
$$;

select ok(pg_temp.incomplete_split_is_rejected(), 'incomplete split payments are blocked');

insert into payment_test_result
select 'card-cash-change', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '30303030-3030-4030-8030-303030303030',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(
    jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CARD'),
      'amount_minor', 500
    ),
    jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 1000
    )
  )
) checkout;

select is(
  (select change_minor from payment_test_result where label = 'card-cash-change'),
  500::bigint,
  'cash change is correct after a partial card payment'
);
select is(
  (
    select sum(amount_minor)
    from public.payments
    where sale_id = (select sale_id from payment_test_result where label = 'card-cash-change')
  ),
  1000::numeric,
  'card plus cash change records exactly the sale total'
);

update payment_test_context
set custom_method_id = public.create_store_scoped_payment_method(
  organization_id,
  'GrabPay',
  'GRABPAY',
  'E_WALLET',
  true,
  array[store_id]
);

insert into payment_test_result
select 'custom', checkout.*
from public.checkout_sale(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select register_id from payment_test_context),
  '31313131-3131-4313-8313-313131313131',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select custom_method_id from payment_test_context),
    'amount_minor', 1000,
    'reference_number', 'GRAB-123'
  ))
) checkout;

select is(
  (select payment_summary -> 0 ->> 'name' from payment_test_result where label = 'custom'),
  'GrabPay',
  'a custom payment method can be used by the POS checkout'
);

create or replace function pg_temp.disabled_store_method_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_sale(
    (select organization_id from payment_test_context),
    (select store_id from payment_test_context),
    (select register_id from payment_test_context),
    '32323232-3232-4232-8232-323232323232',
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'MAYA'),
      'amount_minor', 1000
    ))
  );
  return false;
exception
  when check_violation then
    return true;
end;
$$;

select public.set_store_payment_method_configuration(
  (select organization_id from payment_test_context),
  (select store_id from payment_test_context),
  (select id from public.payment_methods where code = 'MAYA'),
  false
);

select ok(pg_temp.disabled_store_method_is_rejected(), 'a disabled store payment method cannot be used');

select ok(
  (
    select was_replayed
    from public.checkout_sale(
      (select organization_id from payment_test_context),
      (select store_id from payment_test_context),
      (select register_id from payment_test_context),
      '22222222-2222-4222-8222-222222222222',
      jsonb_build_array(jsonb_build_object(
        'product_id', (select product_id from payment_test_context), 'variant_id', null, 'quantity', 1
      )),
      jsonb_build_array(jsonb_build_object(
        'payment_method_id', (select id from public.payment_methods where code = 'CARD'),
        'amount_minor', 1000
      ))
    )
  ),
  'replaying a multi-payment checkout key returns the original sale'
);
select is(
  (select count(*) from public.sales),
  9::bigint,
  'idempotent replay and rejected payments do not add another sale'
);

select * from finish();
rollback;
