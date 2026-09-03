begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data)
values (
  'c52ec16d-44b7-4d28-8c8a-939cb515128d',
  'payment-completion-state@tindio.test',
  '{"full_name":"Payment Completion State Owner"}'::jsonb
);

create temporary table payment_completion_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  product_id uuid
);

grant select, insert, update on payment_completion_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'c52ec16d-44b7-4d28-8c8a-939cb515128d';

insert into payment_completion_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization(
  'Payment Completion Test Retail',
  'Payment Completion Test Main',
  'Payment Completion Test Counter'
);

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'Payment completion tests', 1
  from payment_completion_context
  returning id
)
update payment_completion_context
set category_id = (select id from inserted_category);

update payment_completion_context
set product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Payment completion test item',
  'Untracked product for payment completion state tests',
  'simple',
  'PAYMENT-COMPLETION-ITEM',
  '480000158500',
  158500,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

do $$
begin
  perform public.open_register_shift(
    (select organization_id from payment_completion_context),
    (select store_id from payment_completion_context),
    (select register_id from payment_completion_context),
    1000,
    'Payment completion state test opening float'
  );
end;
$$;

select is(
  (
    select checkout.change_minor
    from public.checkout_advanced_sale(
      (select organization_id from payment_completion_context),
      (select store_id from payment_completion_context),
      (select register_id from payment_completion_context),
      '1a16f13d-1111-4111-8111-111111111111',
      jsonb_build_array(jsonb_build_object(
        'product_id', (select product_id from payment_completion_context),
        'variant_id', null,
        'quantity', 1
      )),
      jsonb_build_array(jsonb_build_object(
        'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
        'amount_tendered_minor', 158500
      )),
      null, 0, null, null, null, null
    ) checkout
  ),
  0::bigint,
  'Test 1: exact ₱1,585 cash payment completes with zero remaining and zero change'
);

select is(
  (
    select checkout.change_minor
    from public.checkout_advanced_sale(
      (select organization_id from payment_completion_context),
      (select store_id from payment_completion_context),
      (select register_id from payment_completion_context),
      '2b27f24d-2222-4222-8222-222222222222',
      jsonb_build_array(jsonb_build_object(
        'product_id', (select product_id from payment_completion_context),
        'variant_id', null,
        'quantity', 1
      )),
      jsonb_build_array(jsonb_build_object(
        'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
        'amount_tendered_minor', 160000
      )),
      null, 0, null, null, null, null
    ) checkout
  ),
  1500::bigint,
  'Test 2: ₱1,600 cash payment completes with ₱15 change'
);

create or replace function pg_temp.insufficient_payment_is_blocked()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_advanced_sale(
    (select organization_id from payment_completion_context),
    (select store_id from payment_completion_context),
    (select register_id from payment_completion_context),
    '3c38f35d-3333-4333-8333-333333333333',
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from payment_completion_context),
      'variant_id', null,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 150000
    )),
    null, 0, null, null, null, null
  );
  return false;
exception
  when check_violation then return true;
end;
$$;

select ok(
  pg_temp.insufficient_payment_is_blocked(),
  'Test 3: ₱1,500 cash payment is blocked when ₱85 remains'
);

select * from finish();

rollback;
