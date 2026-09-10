begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select has_column('public', 'stock_requests', 'operation_id', 'stock requests retain a stable operation key');
select has_column('public', 'stock_transfers', 'transfer_number', 'transfers retain a human reference');
select has_column('public', 'stock_transfers', 'operation_id', 'transfer dispatches retain a stable operation key');
select has_column('public', 'stock_transfer_receipts', 'receipt_number', 'transfer receipts retain a human reference');
select has_column('public', 'stock_transfer_receipts', 'operation_id', 'transfer receipts retain a stable operation key');
select ok(to_regprocedure('public.create_stock_request(uuid,uuid,uuid,text,jsonb,uuid)') is not null, 'idempotent stock-request routine exists');
select ok(to_regprocedure('public.dispatch_stock_request(uuid,uuid,text,uuid)') is not null, 'idempotent dispatch routine exists');
select ok(to_regprocedure('public.receive_stock_request(uuid,uuid,jsonb,text,uuid)') is not null, 'idempotent request receipt routine exists');
select ok(to_regprocedure('public.receive_stock_transfer(uuid,uuid,jsonb,text,uuid)') is not null, 'idempotent legacy receipt routine exists');
select ok(not has_function_privilege('authenticated', 'public.ship_stock_transfer(uuid,uuid,uuid,jsonb,text)', 'execute'), 'application roles cannot use the immediate-shipment bypass');

insert into auth.users (id, email, raw_user_meta_data)
values ('93939393-9393-4939-8939-939393939393', 'transfer-operation-owner@tindio.test', '{"full_name":"Transfer Operation Owner"}'::jsonb);

create temporary table transfer_operation_context (
  organization_id uuid not null,
  source_store_id uuid not null,
  destination_store_id uuid,
  register_id uuid not null,
  product_id uuid,
  warehouse_id uuid,
  request_id uuid,
  request_line_id uuid,
  transfer_id uuid,
  transfer_line_id uuid,
  request_operation_id uuid not null default 'aaaaaaaa-0000-4000-8000-000000000001',
  dispatch_operation_id uuid not null default 'aaaaaaaa-0000-4000-8000-000000000002',
  receipt_operation_id uuid not null default 'aaaaaaaa-0000-4000-8000-000000000003'
);
grant select, insert, update on transfer_operation_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '93939393-9393-4939-8939-939393939393';

insert into transfer_operation_context (organization_id, source_store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Transfer Operation Retail', 'Transfer Main', 'Transfer Counter');

with destination_store as (
  insert into public.stores (organization_id, name, code)
  values ((select organization_id from transfer_operation_context), 'Transfer Branch', 'TRANSFER-BRANCH')
  returning id
)
update transfer_operation_context
set destination_store_id = destination_store.id
from destination_store;

insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.destination_store_id
from transfer_operation_context context
join public.employees employee on employee.organization_id = context.organization_id
where employee.profile_id = auth.uid();

update transfer_operation_context
set product_id = public.create_catalog_product(
  organization_id, null, 'Transfer Operation Item', 'Transfer lifecycle test item', 'simple', 'TRANSFER-OPERATION-ITEM', '480000099501', 2500, 1000, true, 'each', array[source_store_id, destination_store_id], '[]'::jsonb
);
select public.create_inventory_adjustment_reason((select organization_id from transfer_operation_context), 'SEED', 'Opening transfer stock', 'ADJUSTMENT');
select public.record_inventory_adjustment(
  (select organization_id from transfer_operation_context), (select source_store_id from transfer_operation_context), (select product_id from transfer_operation_context), null, 4, 'SEED', 'Seed transfer source', gen_random_uuid(), null
);
update transfer_operation_context
set warehouse_id = public.create_supply_chain_warehouse(organization_id, source_store_id, 'TRANSFER-SOURCE', 'Transfer source warehouse', 'Dispatch stock');

update transfer_operation_context
set request_id = public.create_stock_request(
  organization_id,
  destination_store_id,
  warehouse_id,
  'Retry-safe transfer request',
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '4')),
  request_operation_id
);
select is(
  public.create_stock_request(
    (select organization_id from transfer_operation_context),
    (select destination_store_id from transfer_operation_context),
    (select warehouse_id from transfer_operation_context),
    'Retry-safe transfer request',
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from transfer_operation_context), 'variant_id', null, 'quantity', '4')),
    (select request_operation_id from transfer_operation_context)
  ),
  (select request_id from transfer_operation_context),
  'retrying the same request operation returns the original request'
);
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from transfer_operation_context) and product_id = (select product_id from transfer_operation_context)), 4::numeric, 'planning a request leaves source stock unchanged');
select throws_ok(
  format(
    $$select public.create_stock_request(%L, %L, %L, 'Invalid same-store request', %L::jsonb, gen_random_uuid())$$,
    (select organization_id from transfer_operation_context),
    (select source_store_id from transfer_operation_context),
    (select warehouse_id from transfer_operation_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from transfer_operation_context), 'variant_id', null, 'quantity', '1'))
  ),
  '23514',
  'Choose an active warehouse at a different stock location.',
  'source and destination must differ'
);

update transfer_operation_context
set request_line_id = (select id from public.stock_request_lines where stock_request_id = transfer_operation_context.request_id);
select public.approve_stock_request(
  (select organization_id from transfer_operation_context),
  (select request_id from transfer_operation_context),
  jsonb_build_array(jsonb_build_object('stock_request_line_id', (select request_line_id from transfer_operation_context), 'approved_quantity', '4'))
);
select public.start_stock_request_picking((select organization_id from transfer_operation_context), (select request_id from transfer_operation_context));
update transfer_operation_context
set transfer_id = public.dispatch_stock_request(organization_id, request_id, 'Dispatch four', dispatch_operation_id);
select is(
  public.dispatch_stock_request(
    (select organization_id from transfer_operation_context),
    (select request_id from transfer_operation_context),
    'Dispatch four',
    (select dispatch_operation_id from transfer_operation_context)
  ),
  (select transfer_id from transfer_operation_context),
  'retrying the same dispatch operation returns the original transfer'
);
update transfer_operation_context
set transfer_line_id = (select id from public.stock_transfer_lines where stock_transfer_id = transfer_operation_context.transfer_id);
select ok((select transfer_number is not null from public.stock_transfers where id = (select transfer_id from transfer_operation_context)), 'dispatch assigns a human transfer reference');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from transfer_operation_context) and product_id = (select product_id from transfer_operation_context)), 0::numeric, 'dispatch reduces source stock exactly once');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from transfer_operation_context) and product_id = (select product_id from transfer_operation_context)), 0::numeric, 'dispatch does not increase destination stock');
select throws_ok(
  format(
    $$select public.receive_stock_transfer(%L, %L, %L::jsonb, 'Bypass request receipt', gen_random_uuid())$$,
    (select organization_id from transfer_operation_context),
    (select transfer_id from transfer_operation_context),
    jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from transfer_operation_context), 'quantity', '4'))
  ),
  '23514',
  'Receive replenishment transfers from the stock request workflow so shortages stay traceable.',
  'generic receipt cannot bypass request shortage tracking'
);

select is(
  public.receive_stock_request(
    (select organization_id from transfer_operation_context),
    (select request_id from transfer_operation_context),
    jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from transfer_operation_context), 'received_quantity', '3', 'short_quantity', '1', 'discrepancy_note', 'One short in transit')),
    'Three received, one short',
    (select receipt_operation_id from transfer_operation_context)
  ),
  (select request_id from transfer_operation_context),
  'receipt records received and short quantities'
);
select is(
  public.receive_stock_request(
    (select organization_id from transfer_operation_context),
    (select request_id from transfer_operation_context),
    jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from transfer_operation_context), 'received_quantity', '3', 'short_quantity', '1', 'discrepancy_note', 'One short in transit')),
    'Three received, one short',
    (select receipt_operation_id from transfer_operation_context)
  ),
  (select request_id from transfer_operation_context),
  'retrying the same receipt operation returns the original request'
);
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from transfer_operation_context) and product_id = (select product_id from transfer_operation_context)), 3::numeric, 'destination receives only the physical quantity once');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer_receipt' and source_id in (select id from public.stock_transfer_receipts where stock_transfer_id = (select transfer_id from transfer_operation_context))), 1::bigint, 'exact retry creates one receipt ledger entry');
select is((select count(*) from public.stock_transfer_receipts where stock_transfer_id = (select transfer_id from transfer_operation_context)), 1::bigint, 'exact retry creates one receipt record');
select is((select status from public.stock_requests where id = (select request_id from transfer_operation_context)), 'received_with_discrepancy', 'short quantity is retained in the request status');

select * from finish();
rollback;
