begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_table('public', 'suppliers', 'suppliers table exists');
select has_table('public', 'purchase_orders', 'purchase orders table exists');
select has_table('public', 'purchase_order_lines', 'purchase order lines table exists');
select has_table('public', 'goods_receipts', 'goods receipts table exists');
select has_table('public', 'goods_receipt_lines', 'goods receipt lines table exists');
select has_table('public', 'inventory_counts', 'inventory counts table exists');
select has_table('public', 'inventory_count_lines', 'inventory count lines table exists');
select has_table('public', 'stock_transfers', 'stock transfers table exists');
select has_table('public', 'stock_transfer_lines', 'stock transfer lines table exists');
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('suppliers', 'purchase_orders', 'purchase_order_lines', 'goods_receipts', 'goods_receipt_lines', 'inventory_counts', 'inventory_count_lines', 'stock_transfers', 'stock_transfer_lines')
      and relation.relrowsecurity
  ),
  9::bigint,
  'RLS is enabled on every Phase 9 table'
);
select ok(
  pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conname = 'inventory_movements_type_values' and conrelid = 'public.inventory_movements'::regclass)) like '%RECEIPT%' 
  and pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conname = 'inventory_movements_type_values' and conrelid = 'public.inventory_movements'::regclass)) like '%TRANSFER_IN%',
  'inventory movements accept Phase 9 ledger types'
);
select ok(to_regprocedure('public.create_supplier(uuid,text,text,text,text,text,text)') is not null, 'supplier creation routine exists');
select ok(to_regprocedure('public.create_purchase_order(uuid,uuid,uuid,text,date,jsonb)') is not null, 'purchase order routine exists');
select ok(to_regprocedure('public.receive_purchase_order(uuid,uuid,jsonb,text)') is not null, 'goods receipt routine exists');
select ok(to_regprocedure('public.complete_inventory_count(uuid,uuid,text,jsonb)') is not null, 'inventory count routine exists');
select ok(to_regprocedure('public.transfer_stock(uuid,uuid,uuid,jsonb,text)') is not null, 'stock transfer routine exists');
select ok(not has_function_privilege('anon', 'public.create_supplier(uuid,text,text,text,text,text,text)', 'execute'), 'anonymous callers cannot create suppliers');
select ok(not has_table_privilege('authenticated', 'public.suppliers', 'insert'), 'authenticated callers cannot insert suppliers directly');
select ok(not has_table_privilege('authenticated', 'public.purchase_orders', 'insert'), 'authenticated callers cannot insert purchase orders directly');

insert into auth.users (id, email, raw_user_meta_data)
values ('91919191-9191-4919-8919-919191919191', 'inventory-owner@tindio.test', '{"full_name":"Inventory Owner"}'::jsonb);

create temporary table inventory_phase_9_context (
  organization_id uuid not null,
  store_id uuid not null,
  destination_store_id uuid,
  register_id uuid not null,
  product_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  purchase_order_line_id uuid
);

grant select, insert, update on inventory_phase_9_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '91919191-9191-4919-8919-919191919191';

insert into inventory_phase_9_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Phase 9 Test Retail', 'Phase 9 Main', 'Phase 9 Counter');

select ok(exists (select 1 from public.employees where organization_id = (select organization_id from inventory_phase_9_context)), 'bootstrap creates an inventory actor');

with destination_store as (
  insert into public.stores (organization_id, name, code)
  values ((select organization_id from inventory_phase_9_context), 'Phase 9 Branch', 'BRANCH')
  returning id
)
update inventory_phase_9_context
set destination_store_id = destination_store.id
from destination_store;

insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.destination_store_id
from inventory_phase_9_context context
join public.employees employee on employee.organization_id = context.organization_id
where employee.profile_id = auth.uid();

update inventory_phase_9_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Phase 9 Tracked Item',
  'A receipt, count, and transfer test product',
  'simple',
  'PHASE9-ITEM',
  '480000090009',
  2500,
  1000,
  true,
  'each',
  array[store_id, destination_store_id],
  '[]'::jsonb
);

select is(
  (select count(*) from public.inventory_levels where product_id = (select product_id from inventory_phase_9_context)),
  2::bigint,
  'tracked product creates projections for both stores'
);

update inventory_phase_9_context
set supplier_id = public.create_supplier(organization_id, 'Phase 9 Supplier', 'Ava Supplier', '', '09170000000', '', '');

select is((select count(*) from public.suppliers), 1::bigint, 'authorized manager creates a supplier through the routine');

update inventory_phase_9_context
set purchase_order_id = public.create_purchase_order(
  organization_id,
  store_id,
  supplier_id,
  'First delivery',
  null,
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '10', 'unit_cost_minor', 1000))
);

select is((select status from public.purchase_orders where id = (select purchase_order_id from inventory_phase_9_context)), 'ordered', 'new purchase order is committed as ordered');

update inventory_phase_9_context
set purchase_order_line_id = (
  select id from public.purchase_order_lines where purchase_order_id = inventory_phase_9_context.purchase_order_id
);

select is((select ordered_quantity from public.purchase_order_lines where id = (select purchase_order_line_id from inventory_phase_9_context)), 10::numeric, 'purchase order preserves ordered quantity');

select lives_ok(
  format(
    $$select public.receive_purchase_order(%L, %L, %L::jsonb, 'Delivered complete')$$,
    (select organization_id from inventory_phase_9_context),
    (select purchase_order_id from inventory_phase_9_context),
    jsonb_build_array(jsonb_build_object('purchase_order_line_id', (select purchase_order_line_id from inventory_phase_9_context), 'quantity', '10'))
  ),
  'receiving a purchase order succeeds'
);

select is(
  (select quantity from public.inventory_levels where store_id = (select store_id from inventory_phase_9_context) and product_id = (select product_id from inventory_phase_9_context)),
  10::numeric,
  'receipt increases the receiving store projection'
);
select is((select status from public.purchase_orders where id = (select purchase_order_id from inventory_phase_9_context)), 'received', 'fully received order is marked received');
select is((select count(*) from public.goods_receipt_lines), 1::bigint, 'receipt line is recorded');

select lives_ok(
  format(
    $$select public.complete_inventory_count(%L, %L, 'Cycle count', %L::jsonb)$$,
    (select organization_id from inventory_phase_9_context),
    (select store_id from inventory_phase_9_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from inventory_phase_9_context), 'variant_id', null, 'counted_quantity', '7'))
  ),
  'inventory count succeeds'
);
select is(
  (select quantity from public.inventory_levels where store_id = (select store_id from inventory_phase_9_context) and product_id = (select product_id from inventory_phase_9_context)),
  7::numeric,
  'count replaces the projection with the physical quantity'
);
select is(
  (select quantity_delta from public.inventory_movements where movement_type = 'COUNT' order by created_at desc limit 1),
  (-3)::numeric,
  'count ledger records only the variance'
);

select lives_ok(
  format(
    $$select public.transfer_stock(%L, %L, %L, %L::jsonb, 'Rebalance stores')$$,
    (select organization_id from inventory_phase_9_context),
    (select store_id from inventory_phase_9_context),
    (select destination_store_id from inventory_phase_9_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from inventory_phase_9_context), 'variant_id', null, 'quantity', '2'))
  ),
  'stock transfer succeeds'
);
select is(
  (select quantity from public.inventory_levels where store_id = (select store_id from inventory_phase_9_context) and product_id = (select product_id from inventory_phase_9_context)),
  5::numeric,
  'transfer decreases source stock'
);
select is(
  (select quantity from public.inventory_levels where store_id = (select destination_store_id from inventory_phase_9_context) and product_id = (select product_id from inventory_phase_9_context)),
  2::numeric,
  'transfer increases destination stock'
);
select is(
  (select sum(quantity_delta) from public.inventory_movements where movement_type in ('TRANSFER_OUT', 'TRANSFER_IN')),
  0::numeric,
  'transfer ledger remains balanced'
);

create or replace function pg_temp.insufficient_transfer_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.transfer_stock(
    (select organization_id from inventory_phase_9_context),
    (select store_id from inventory_phase_9_context),
    (select destination_store_id from inventory_phase_9_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from inventory_phase_9_context), 'variant_id', null, 'quantity', '6')),
    'Too much stock'
  );
  return false;
exception when check_violation then
  return true;
end;
$$;

select ok(pg_temp.insufficient_transfer_is_rejected(), 'transfer rejects more stock than the source holds');

select * from finish();
rollback;
