begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '6e3b7b1e-45cb-47c7-970d-47c7c563cf14',
  'checkout-tender-owner@tindio.test',
  '{"full_name":"Checkout Tender Owner"}'::jsonb
);

create temporary table checkout_tender_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  product_id uuid
);

create temporary table checkout_tender_result (
  label text primary key,
  sale_id uuid not null,
  total_minor bigint not null,
  change_minor bigint not null,
  payment_summary jsonb not null
);

grant select, insert, update on checkout_tender_context, checkout_tender_result to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '6e3b7b1e-45cb-47c7-970d-47c7c563cf14';

insert into checkout_tender_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization(
  'Checkout Tender Test Retail',
  'Checkout Tender Test Main',
  'Checkout Tender Test Counter'
);

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'Checkout Tender Tests', 1
  from checkout_tender_context
  returning id
)
update checkout_tender_context
set category_id = (select id from inserted_category);

update checkout_tender_context
set product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Checkout Tender Test Item',
  'Untracked checkout tender test product',
  'simple',
  'CHECKOUT-TENDER-ITEM',
  '480000183500',
  183500,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 1000, 'Checkout tender test opening float')$$,
    (select organization_id from checkout_tender_context),
    (select store_id from checkout_tender_context),
    (select register_id from checkout_tender_context)
  ),
  'an owner can open a shift before advanced checkout tender tests'
);

insert into checkout_tender_result
select 'cash-change', checkout.sale_id, checkout.total_minor, checkout.change_minor, checkout.payment_summary
from public.checkout_advanced_sale(
  (select organization_id from checkout_tender_context),
  (select store_id from checkout_tender_context),
  (select register_id from checkout_tender_context),
  'a1a1a1a1-1111-4111-8111-111111111111',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from checkout_tender_context),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
    'amount_tendered_minor', 184000
  )),
  null, 0, null, null, null, null
) checkout;

select is(
  (select total_minor from checkout_tender_result where label = 'cash-change'),
  183500::bigint,
  'advanced checkout retains the authoritative sale total when cash is over-tendered'
);
select is(
  (select change_minor from checkout_tender_result where label = 'cash-change'),
  500::bigint,
  'advanced checkout calculates change from tendered cash'
);
select is(
  (select payment_summary -> 0 ->> 'amount_minor' from checkout_tender_result where label = 'cash-change'),
  '183500',
  'advanced checkout applies only the sale amount from over-tendered cash'
);
select is(
  (select payment_summary -> 0 ->> 'amount_tendered_minor' from checkout_tender_result where label = 'cash-change'),
  '184000',
  'advanced checkout preserves the original cash tender for audit'
);
select is(
  (
    select amount_minor
    from public.payments
    where sale_id = (select sale_id from checkout_tender_result where label = 'cash-change')
  ),
  183500::bigint,
  'cash drawer and revenue use the applied cash amount, not the tender'
);

insert into checkout_tender_result
select 'gcash-cash-change', checkout.sale_id, checkout.total_minor, checkout.change_minor, checkout.payment_summary
from public.checkout_advanced_sale(
  (select organization_id from checkout_tender_context),
  (select store_id from checkout_tender_context),
  (select register_id from checkout_tender_context),
  'b2b2b2b2-2222-4222-8222-222222222222',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from checkout_tender_context),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(
    jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'GCASH'),
      'amount_minor', 100000
    ),
    jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 100000
    )
  ),
  null, 0, null, null, null, null
) checkout;

select is(
  (select total_minor from checkout_tender_result where label = 'gcash-cash-change'),
  183500::bigint,
  'split checkout retains the authoritative sale total'
);
select is(
  (select change_minor from checkout_tender_result where label = 'gcash-cash-change'),
  16500::bigint,
  'split checkout calculates cash change only from the remaining due'
);
select is(
  (
    select sum(amount_minor)
    from public.payments
    where sale_id = (select sale_id from checkout_tender_result where label = 'gcash-cash-change')
  ),
  183500::numeric,
  'split applied payments reconcile to the sale total despite cash change'
);
select is(
  (
    select amount_minor
    from public.payments
    where sale_id = (select sale_id from checkout_tender_result where label = 'gcash-cash-change')
      and payment_method_type_snapshot = 'CASH'
  ),
  83500::bigint,
  'the cash portion applies only the post-GCash remaining balance'
);

select is(
  (
    select (public.get_pos_shift_operational_summary(
      context.organization_id,
      shift.id
    ) -> 'cash' ->> 'cashPaymentsMinor')::bigint
    from checkout_tender_context context
    join public.shifts shift
      on shift.organization_id = context.organization_id
     and shift.store_id = context.store_id
     and shift.register_id = context.register_id
     and shift.status = 'open'
  ),
  267000::bigint,
  'shift cash accounting uses applied cash and never the excess tender'
);

create or replace function pg_temp.insufficient_cash_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_advanced_sale(
    (select organization_id from checkout_tender_context),
    (select store_id from checkout_tender_context),
    (select register_id from checkout_tender_context),
    'c3c3c3c3-3333-4333-8333-333333333333',
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from checkout_tender_context),
      'variant_id', null,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 183400
    )),
    null, 0, null, null, null, null
  );
  return false;
exception
  when check_violation then return true;
end;
$$;

select ok(
  pg_temp.insufficient_cash_is_rejected(),
  'advanced checkout rejects insufficient cash instead of treating it as a completed sale'
);

select * from finish();

rollback;
