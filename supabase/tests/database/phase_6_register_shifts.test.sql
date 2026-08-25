begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

select has_table('public', 'shifts', 'shifts table exists');
select has_table('public', 'cash_movements', 'cash movements table exists');
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('shifts', 'cash_movements')
      and relation.relrowsecurity
  ),
  2::bigint,
  'RLS is enabled on every Phase 6 table'
);
select ok(to_regprocedure('public.open_register_shift(uuid,uuid,uuid,bigint,text)') is not null, 'open shift routine exists');
select ok(to_regprocedure('public.close_register_shift(uuid,uuid,bigint,text)') is not null, 'close shift routine exists');
select ok(to_regprocedure('public.record_cash_movement(uuid,uuid,text,bigint,text,uuid,uuid)') is not null, 'cash movement routine exists');
select ok(to_regprocedure('public.get_shift_cash_summary(uuid,uuid)') is not null, 'cash summary routine exists');
select ok(
  not has_function_privilege('anon', 'public.open_register_shift(uuid,uuid,uuid,bigint,text)', 'execute'),
  'anonymous callers cannot open shifts'
);
select ok(not has_table_privilege('authenticated', 'public.shifts', 'insert'), 'authenticated callers cannot insert shifts directly');
select ok(not has_table_privilege('authenticated', 'public.cash_movements', 'insert'), 'authenticated callers cannot insert cash movements directly');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('61616161-6161-4616-8616-616161616161', 'shift-owner@tindio.test', '{"full_name":"Shift Owner"}'::jsonb),
  ('62626262-6262-4626-8626-626262626262', 'shift-other-owner@tindio.test', '{"full_name":"Other Shift Owner"}'::jsonb);

create temporary table shift_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  shift_id uuid,
  product_id uuid,
  sale_id uuid,
  refund_id uuid
);

grant select, insert, update on table shift_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '61616161-6161-4616-8616-616161616161';

insert into shift_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Shift Test Retail', 'Shift Test Main', 'Shift Test Counter');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '62626262-6262-4626-8626-626262626262';

select *
from public.bootstrap_organization('Other Shift Retail', 'Other Shift Main', 'Other Shift Counter');

reset role;

create or replace function pg_temp.duplicate_shift_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.open_register_shift(
    (select organization_id from shift_test_context),
    (select store_id from shift_test_context),
    (select register_id from shift_test_context),
    9999,
    'Different opening float'
  );
  return false;
exception
  when unique_violation then
    return true;
end;
$$;

create or replace function pg_temp.closed_shift_movement_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.record_cash_movement(
    (select organization_id from shift_test_context),
    (select shift_id from shift_test_context),
    'PAY_IN',
    100,
    'After close',
    '69696969-6969-4969-8969-696969696969'
  );
  return false;
exception
  when no_data_found then
    return true;
end;
$$;

create or replace function pg_temp.closed_shift_checkout_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.checkout_sale(
    (select organization_id from shift_test_context),
    (select store_id from shift_test_context),
    (select register_id from shift_test_context),
    '70707070-7070-4070-8070-707070707070',
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from shift_test_context),
      'variant_id', null,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
      'amount_tendered_minor', 1000
    ))
  );
  return false;
exception
  when check_violation then
    return true;
end;
$$;

create or replace function pg_temp.cross_tenant_shift_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.open_register_shift(
    (select organization_id from shift_test_context),
    (select store_id from shift_test_context),
    (select register_id from shift_test_context),
    0,
    null
  );
  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '61616161-6161-4616-8616-616161616161';

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 10000, 'Opening float')$$,
    (select organization_id from shift_test_context),
    (select store_id from shift_test_context),
    (select register_id from shift_test_context)
  ),
  'owner can open an assigned active register shift'
);

update shift_test_context
set shift_id = (select id from public.shifts limit 1);

select is((select count(*) from public.shifts), 1::bigint, 'one open shift is recorded');
select is((select opening_cash_minor from public.shifts), 10000::bigint, 'opening cash is recorded in minor units');
select ok(pg_temp.duplicate_shift_is_rejected(), 'a register cannot have a conflicting second open shift');

update shift_test_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Shift Test Item',
  'Untracked shift test product',
  'simple',
  'SHIFT-ITEM',
  '480000070001',
  1000,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

update shift_test_context context
set sale_id = checkout.sale_id
from public.checkout_sale(
  (select organization_id from shift_test_context),
  (select store_id from shift_test_context),
  (select register_id from shift_test_context),
  '63636363-6363-4636-8636-636363636363',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from shift_test_context),
    'variant_id', null,
    'quantity', 2
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (select id from public.payment_methods where code = 'CASH'),
    'amount_tendered_minor', 2000
  ))
) checkout;

select is((select shift_id from public.sales), (select shift_id from shift_test_context), 'completed sales are assigned to the open shift');
select is((select amount_minor from public.payments), 2000::bigint, 'cash sale records its net cash amount');

select lives_ok(
  format(
    $$select public.record_cash_movement(%L, %L, 'PAY_IN', 500, 'Petty cash return', '64646464-6464-4646-8646-646464646464')$$,
    (select organization_id from shift_test_context),
    (select shift_id from shift_test_context)
  ),
  'authorized pay-in is recorded'
);
select ok(
  (
    select was_replayed
    from public.record_cash_movement(
      (select organization_id from shift_test_context),
      (select shift_id from shift_test_context),
      'PAY_IN', 500, 'Petty cash return', '64646464-6464-4646-8646-646464646464'
    )
  ),
  'replaying the same cash movement key returns its original result'
);
select is((select count(*) from public.cash_movements), 1::bigint, 'cash movement idempotency prevents a duplicate ledger entry');
select lives_ok(
  format(
    $$select public.record_cash_movement(%L, %L, 'PAY_OUT', 300, 'Supplier collection', '65656565-6565-4656-8656-656565656565')$$,
    (select organization_id from shift_test_context),
    (select shift_id from shift_test_context)
  ),
  'authorized pay-out is recorded'
);

update shift_test_context context
set refund_id = refund.refund_id
from public.refund_sale(
  (select organization_id from shift_test_context),
  (select sale_id from shift_test_context),
  (select id from public.payment_methods where code = 'CASH'),
  '66666666-6666-4666-8666-666666666666',
  'One item returned',
  null,
  jsonb_build_array(jsonb_build_object(
    'sale_item_id', (select id from public.sale_items where sale_id = (select sale_id from shift_test_context)),
    'quantity', 1
  ))
) refund;

select is((select shift_id from public.refunds), (select shift_id from shift_test_context), 'cash refunds are assigned to the open shift');
select is((select cash_sales_minor from public.get_shift_cash_summary((select organization_id from shift_test_context), (select shift_id from shift_test_context))), 2000::bigint, 'cash summary includes cash sales');
select is((select cash_refunds_minor from public.get_shift_cash_summary((select organization_id from shift_test_context), (select shift_id from shift_test_context))), 1000::bigint, 'cash summary subtracts cash refunds');
select is((select pay_ins_minor from public.get_shift_cash_summary((select organization_id from shift_test_context), (select shift_id from shift_test_context))), 500::bigint, 'cash summary includes pay-ins');
select is((select pay_outs_minor from public.get_shift_cash_summary((select organization_id from shift_test_context), (select shift_id from shift_test_context))), 300::bigint, 'cash summary includes pay-outs');
select is((select expected_cash_minor from public.get_shift_cash_summary((select organization_id from shift_test_context), (select shift_id from shift_test_context))), 11200::bigint, 'cash expectation is server-derived from the ledger');

select lives_ok(
  format(
    $$select public.close_register_shift(%L, %L, 11150, 'Drawer counted')$$,
    (select organization_id from shift_test_context),
    (select shift_id from shift_test_context)
  ),
  'authorized employee can close the open shift'
);
select is((select status from public.shifts), 'closed', 'shift lifecycle records closure');
select is((select expected_cash_minor from public.shifts), 11200::bigint, 'closed shift stores the expected cash snapshot');
select is((select difference_minor from public.shifts), -50::bigint, 'closed shift stores counted minus expected cash');
select ok(pg_temp.closed_shift_movement_is_rejected(), 'cash movements cannot be added after closing a shift');
select ok(pg_temp.closed_shift_checkout_is_rejected(), 'direct checkout is rejected after the current shift closes');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '62626262-6262-4626-8626-626262626262';

select is((select count(*) from public.shifts), 0::bigint, 'another organization cannot read this organization shifts');
select is((select count(*) from public.cash_movements), 0::bigint, 'another organization cannot read this cash ledger');
select ok(pg_temp.cross_tenant_shift_is_rejected(), 'another organization cannot open a shift on this register');

select * from finish();
rollback;
