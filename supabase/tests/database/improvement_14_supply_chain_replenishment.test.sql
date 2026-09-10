begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

select has_table('public', 'supply_chain_warehouses', 'warehouse locations table exists');
select has_table('public', 'inventory_replenishment_rules', 'reorder and target-stock rules table exists');
select has_table('public', 'stock_requests', 'stock requests table exists');
select has_table('public', 'stock_request_lines', 'stock request lines table exists');
select has_table('public', 'stock_request_discrepancies', 'stock request discrepancies table exists');
select has_column('public', 'suppliers', 'lead_time_days', 'suppliers retain lead time');
select has_column('public', 'stock_transfer_lines', 'short_quantity', 'transfer lines retain reported shortages');
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('supply_chain_warehouses', 'inventory_replenishment_rules', 'stock_requests', 'stock_request_lines', 'stock_request_discrepancies')
      and relation.relrowsecurity
  ),
  5::bigint,
  'RLS is enabled on every Phase 14 table'
);
select ok(to_regprocedure('public.create_supply_chain_warehouse(uuid,uuid,text,text,text)') is not null, 'warehouse routine exists');
select ok(to_regprocedure('public.update_supplier_lead_time(uuid,uuid,integer)') is not null, 'supplier lead-time routine exists');
select ok(to_regprocedure('public.upsert_inventory_replenishment_rule(uuid,uuid,uuid,uuid,uuid,numeric,numeric)') is not null, 'replenishment-rule routine exists');
select ok(to_regprocedure('public.create_stock_request(uuid,uuid,uuid,text,jsonb,uuid)') is not null, 'idempotent stock-request submission routine exists');
select ok(to_regprocedure('public.approve_stock_request(uuid,uuid,jsonb)') is not null, 'stock-request approval routine exists');
select ok(to_regprocedure('public.start_stock_request_picking(uuid,uuid)') is not null, 'stock-request picking routine exists');
select ok(to_regprocedure('public.dispatch_stock_request(uuid,uuid,text,uuid)') is not null, 'idempotent stock-request dispatch routine exists');
select ok(to_regprocedure('public.receive_stock_request(uuid,uuid,jsonb,text,uuid)') is not null, 'idempotent stock-request receiving routine exists');
select ok(not has_function_privilege('anon', 'public.dispatch_stock_request(uuid,uuid,text,uuid)', 'execute'), 'anonymous callers cannot dispatch stock requests');
select ok(not has_table_privilege('authenticated', 'public.stock_requests', 'insert'), 'authenticated callers cannot insert requests directly');

insert into auth.users (id, email, raw_user_meta_data)
values ('94949494-9494-4949-9494-949494949494', 'supply-chain-owner@tindio.test', '{"full_name":"Supply Chain Owner"}'::jsonb);

create temporary table supply_chain_context (
  organization_id uuid not null,
  source_store_id uuid not null,
  destination_store_id uuid,
  register_id uuid not null,
  product_id uuid,
  supplier_id uuid,
  warehouse_id uuid,
  request_id uuid,
  request_line_id uuid,
  transfer_id uuid,
  transfer_line_id uuid
);
grant select, insert, update on supply_chain_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '94949494-9494-4949-9494-949494949494';

insert into supply_chain_context (organization_id, source_store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Supply Chain Retail', 'Central Warehouse Stock', 'Warehouse Counter');

with destination_store as (
  insert into public.stores (organization_id, name, code)
  values ((select organization_id from supply_chain_context), 'Supply Chain Branch', 'SUPPLY-BRANCH')
  returning id
)
update supply_chain_context
set destination_store_id = destination_store.id
from destination_store;

insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.destination_store_id
from supply_chain_context context
join public.employees employee on employee.organization_id = context.organization_id
where employee.profile_id = auth.uid();

update supply_chain_context
set product_id = public.create_catalog_product(
  organization_id, null, 'Supply Chain Item', 'Replenishment test item', 'simple', 'SUPPLY-ITEM', '480000099401', 2500, 1000, true, 'each', array[source_store_id, destination_store_id], '[]'::jsonb
);

select public.create_inventory_adjustment_reason(
  (select organization_id from supply_chain_context), 'SEED', 'Opening supply chain stock', 'ADJUSTMENT'
);
select public.record_inventory_adjustment(
  (select organization_id from supply_chain_context), (select source_store_id from supply_chain_context), (select product_id from supply_chain_context), null, 10, 'SEED', 'Seed warehouse stock', gen_random_uuid(), null
);

update supply_chain_context
set supplier_id = public.create_supplier(organization_id, 'Lead Time Supplier', '', '', '', '', '');
select public.update_supplier_lead_time((select organization_id from supply_chain_context), (select supplier_id from supply_chain_context), 4);
select is((select lead_time_days from public.suppliers where id = (select supplier_id from supply_chain_context)), 4, 'supplier lead time is saved');
create temporary table lead_time_purchase_context (purchase_order_id uuid not null);
grant select, insert on lead_time_purchase_context to authenticated;
insert into lead_time_purchase_context (purchase_order_id)
select public.create_purchase_order(
  (select organization_id from supply_chain_context),
  (select source_store_id from supply_chain_context),
  (select supplier_id from supply_chain_context),
  'Lead-time test purchase order',
  null,
  jsonb_build_array(jsonb_build_object('product_id', (select product_id from supply_chain_context), 'variant_id', null, 'purchase_unit_code', 'each', 'quantity', '1', 'unit_cost_minor', 1000)),
  gen_random_uuid()
);
select is(
  (select expected_at from public.purchase_orders where id = (select purchase_order_id from lead_time_purchase_context)),
  current_date + 4,
  'blank purchase-order expected dates use supplier lead time'
);

update supply_chain_context
set warehouse_id = public.create_supply_chain_warehouse(organization_id, source_store_id, 'CENTRAL', 'Central warehouse', 'Primary dispatch location');
select is((select count(*) from public.supply_chain_warehouses), 1::bigint, 'warehouse location is retained');

select public.upsert_inventory_replenishment_rule(
  (select organization_id from supply_chain_context), (select destination_store_id from supply_chain_context), (select product_id from supply_chain_context), null,
  (select warehouse_id from supply_chain_context), 3, 10
);
select is((select target_stock from public.inventory_replenishment_rules), 10::numeric, 'target stock rule is saved');

update supply_chain_context
set request_id = public.create_stock_request(
  organization_id, destination_store_id, warehouse_id, 'Need branch replenishment',
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '10')),
  gen_random_uuid()
);
update supply_chain_context
set request_line_id = (select id from public.stock_request_lines where stock_request_id = supply_chain_context.request_id);
select is((select status from public.stock_requests where id = (select request_id from supply_chain_context)), 'requested', 'stock request begins submitted');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from supply_chain_context) and product_id = (select product_id from supply_chain_context)), 10::numeric, 'submitting a request does not reduce warehouse stock');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from supply_chain_context) and product_id = (select product_id from supply_chain_context)), 0::numeric, 'submitting a request does not increase branch stock');

select lives_ok(
  format(
    $$select public.approve_stock_request(%L, %L, %L::jsonb)$$,
    (select organization_id from supply_chain_context), (select request_id from supply_chain_context),
    jsonb_build_array(jsonb_build_object('stock_request_line_id', (select request_line_id from supply_chain_context), 'approved_quantity', '10'))
  ),
  'warehouse can approve the requested quantity'
);
select is((select status from public.stock_requests where id = (select request_id from supply_chain_context)), 'approved', 'approval advances the request');
select public.start_stock_request_picking((select organization_id from supply_chain_context), (select request_id from supply_chain_context));
select is((select status from public.stock_requests where id = (select request_id from supply_chain_context)), 'picking', 'picking is an explicit intermediate state');

update supply_chain_context
set transfer_id = public.dispatch_stock_request(organization_id, request_id, 'Packed and handed to courier', gen_random_uuid());
update supply_chain_context
set transfer_line_id = (select id from public.stock_transfer_lines where stock_transfer_id = supply_chain_context.transfer_id);
select is((select status from public.stock_requests where id = (select request_id from supply_chain_context)), 'dispatched', 'dispatch advances the request');
select is((select status from public.stock_transfers where id = (select transfer_id from supply_chain_context)), 'in_transit', 'dispatch creates the authoritative in-transit transfer');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from supply_chain_context) and product_id = (select product_id from supply_chain_context)), 0::numeric, 'dispatch reduces source stock');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from supply_chain_context) and product_id = (select product_id from supply_chain_context)), 0::numeric, 'dispatch still does not increase destination stock');

select lives_ok(
  format(
    $$select public.receive_stock_request(%L, %L, %L::jsonb, 'Nine received, one short', gen_random_uuid())$$,
    (select organization_id from supply_chain_context), (select request_id from supply_chain_context),
    jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from supply_chain_context), 'received_quantity', '9', 'short_quantity', '1', 'discrepancy_note', 'One carton short in transit'))
  ),
  'partial receipt with a shortage succeeds'
);
select is((select status from public.stock_transfers where id = (select transfer_id from supply_chain_context)), 'completed', 'the transfer completes once every dispatched quantity is received or formally short');
select is((select status from public.stock_requests where id = (select request_id from supply_chain_context)), 'received_with_discrepancy', 'the request visibly retains its shortage outcome');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from supply_chain_context) and product_id = (select product_id from supply_chain_context)), 9::numeric, 'only physically received stock reaches the destination');
select is((select short_quantity from public.stock_request_lines where id = (select request_line_id from supply_chain_context)), 1::numeric, 'the request line retains the missing quantity');
select is((select count(*) from public.stock_request_discrepancies where stock_request_id = (select request_id from supply_chain_context)), 1::bigint, 'a discrepancy record is retained');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer_receipt' and store_id = (select destination_store_id from supply_chain_context)), 1::bigint, 'one destination ledger movement records the physical receipt');

select * from finish();
rollback;
