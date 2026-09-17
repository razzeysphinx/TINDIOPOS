begin;

create extension if not exists pgtap with schema extensions;

select plan(63);

select has_table('private', 'stock_transfer_operations', 'canonical operation registry exists outside the Data API schema');
select col_is_unique('private', 'stock_transfer_operations', array['organization_id', 'operation_id'], 'operation IDs are unique per organization');
select ok(to_regprocedure('public.create_inventory_transfer_draft(uuid,uuid,uuid,jsonb,text,uuid)') is not null, 'canonical create command exists');
select ok(to_regprocedure('public.submit_inventory_transfer(uuid,uuid,text,uuid)') is not null, 'canonical submit command exists');
select ok(to_regprocedure('public.approve_inventory_transfer(uuid,uuid,text,uuid)') is not null, 'canonical approve command exists');
select ok(to_regprocedure('public.dispatch_inventory_transfer(uuid,uuid,text,uuid)') is not null, 'canonical dispatch command exists');
select ok(to_regprocedure('public.receive_inventory_transfer(uuid,uuid,jsonb,text,uuid)') is not null, 'canonical receive command exists');
select ok(to_regprocedure('public.cancel_inventory_transfer(uuid,uuid,text,uuid)') is not null, 'canonical cancel command exists');
select ok(has_function_privilege('authenticated', 'public.create_inventory_transfer_draft(uuid,uuid,uuid,jsonb,text,uuid)', 'execute'), 'authenticated callers may execute canonical create');
select ok(not has_function_privilege('anon', 'public.create_inventory_transfer_draft(uuid,uuid,uuid,jsonb,text,uuid)', 'execute'), 'anonymous callers cannot execute canonical create');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.stock_transfers'::regclass and conname = 'stock_transfers_status_values')
    like all (array['%draft%', '%submitted%', '%approved%', '%dispatched%', '%partially_received%', '%received%', '%cancelled%']),
  'the effective constraint contains all seven canonical physical states'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.stock_transfers'::regclass and conname = 'stock_transfers_status_values')
    not like all (array['%in_transit%', '%completed%']),
  'the effective constraint excludes both legacy physical states'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('95959595-9595-4959-8959-959595959595', 'canonical-transfer-owner@tindio.test', '{"full_name":"Canonical Transfer Owner"}'::jsonb);

create temporary table canonical_transfer_context (
  organization_id uuid not null,
  source_store_id uuid not null,
  destination_store_id uuid,
  register_id uuid not null,
  product_id uuid,
  transfer_id uuid,
  transfer_line_id uuid,
  cancel_transfer_id uuid,
  direct_transfer_id uuid,
  direct_transfer_line_id uuid,
  request_id uuid,
  request_line_id uuid,
  request_transfer_id uuid,
  request_transfer_line_id uuid,
  warehouse_id uuid,
  create_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000001',
  submit_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000002',
  approve_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000003',
  dispatch_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000004',
  partial_receipt_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000005',
  final_receipt_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000006',
  cancel_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000007',
  direct_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000008',
  direct_receipt_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000009',
  request_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000010',
  request_dispatch_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000011',
  request_receipt_operation_id uuid not null default 'b1000000-0000-4000-8000-000000000012'
);
grant select, insert, update on canonical_transfer_context to authenticated;
-- Test-only read access to internal evidence is rolled back with this file.
grant select on private.stock_transfer_operations, public.stock_transfer_lines, public.inventory_levels to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '95959595-9595-4959-8959-959595959595';

insert into canonical_transfer_context (organization_id, source_store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Canonical Transfer Retail', 'Canonical Source', 'Canonical Counter');

with destination_store as (
  insert into public.stores (organization_id, name, code)
  values ((select organization_id from canonical_transfer_context), 'Canonical Destination', 'CANONICAL-DEST')
  returning id
)
update canonical_transfer_context
set destination_store_id = destination_store.id
from destination_store;

insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.destination_store_id
from canonical_transfer_context context
join public.employees employee on employee.organization_id = context.organization_id
where employee.profile_id = auth.uid();

update canonical_transfer_context
set product_id = public.create_catalog_product(
  organization_id, null, 'Canonical Transfer Item', 'Canonical transfer test item',
  'simple', 'CANONICAL-TRANSFER-ITEM', '480000099591', 2500, 1000, true, 'each',
  array[source_store_id, destination_store_id], '[]'::jsonb
);
select public.create_inventory_adjustment_reason((select organization_id from canonical_transfer_context), 'SEED', 'Opening transfer stock', 'ADJUSTMENT');
select public.record_inventory_adjustment_v3(
  (select organization_id from canonical_transfer_context),
  (select source_store_id from canonical_transfer_context),
  (select product_id from canonical_transfer_context),
  20, 'SEED', 'Seed canonical transfer source', gen_random_uuid()
);

update canonical_transfer_context
set transfer_id = public.create_inventory_transfer_draft(
  organization_id,
  source_store_id,
  destination_store_id,
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '6')),
  'Canonical six-unit transfer',
  create_operation_id
);
update canonical_transfer_context
set transfer_line_id = (select id from public.stock_transfer_lines where stock_transfer_id = canonical_transfer_context.transfer_id);

select ok((select transfer_id is not null from canonical_transfer_context), 'draft creation returns a transfer ID');
select is(
  public.create_inventory_transfer_draft(
    (select organization_id from canonical_transfer_context),
    (select source_store_id from canonical_transfer_context),
    (select destination_store_id from canonical_transfer_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from canonical_transfer_context), 'variant_id', null, 'quantity', '6')),
    'Canonical six-unit transfer',
    (select create_operation_id from canonical_transfer_context)
  ),
  (select transfer_id from canonical_transfer_context),
  'exact create replay returns the original transfer'
);
select throws_ok(
  format(
    $$select public.create_inventory_transfer_draft(%L,%L,%L,%L::jsonb,'Different payload',%L)$$,
    (select organization_id from canonical_transfer_context),
    (select source_store_id from canonical_transfer_context),
    (select destination_store_id from canonical_transfer_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from canonical_transfer_context), 'variant_id', null, 'quantity', '6')),
    (select create_operation_id from canonical_transfer_context)
  ),
  '23505',
  'This operation ID is already assigned to a different transfer command.',
  'conflicting create replay is rejected'
);
select is((select status from public.stock_transfers where id = (select transfer_id from canonical_transfer_context)), 'draft', 'create produces draft');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 20::numeric, 'draft is source-stock neutral');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 0::numeric, 'draft is destination-stock neutral');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer' and source_id = (select transfer_id from canonical_transfer_context)), 0::bigint, 'draft writes no ledger movement');
select ok(not (select unit_cost_is_known from public.stock_transfer_lines where id = (select transfer_line_id from canonical_transfer_context)), 'draft does not freeze dispatch cost truth');

select public.submit_inventory_transfer(
  (select organization_id from canonical_transfer_context), (select transfer_id from canonical_transfer_context), null,
  (select submit_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select transfer_id from canonical_transfer_context)), 'submitted', 'submit advances draft to submitted');
select is(
  public.submit_inventory_transfer(
    (select organization_id from canonical_transfer_context), (select transfer_id from canonical_transfer_context), null,
    (select submit_operation_id from canonical_transfer_context)
  ),
  (select transfer_id from canonical_transfer_context),
  'exact submit replay returns the transfer'
);
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 20::numeric, 'submit is stock-neutral');

select public.approve_inventory_transfer(
  (select organization_id from canonical_transfer_context), (select transfer_id from canonical_transfer_context), null,
  (select approve_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select transfer_id from canonical_transfer_context)), 'approved', 'approve advances submitted to approved');
select is(
  public.approve_inventory_transfer(
    (select organization_id from canonical_transfer_context), (select transfer_id from canonical_transfer_context), null,
    (select approve_operation_id from canonical_transfer_context)
  ),
  (select transfer_id from canonical_transfer_context),
  'exact approve replay returns the transfer'
);
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 20::numeric, 'approve is stock-neutral');

update canonical_transfer_context
set cancel_transfer_id = public.create_inventory_transfer_draft(
  organization_id, source_store_id, destination_store_id,
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '1')),
  'Cancellation fixture', gen_random_uuid()
);
select public.submit_inventory_transfer((select organization_id from canonical_transfer_context), (select cancel_transfer_id from canonical_transfer_context), null, gen_random_uuid());
select public.approve_inventory_transfer((select organization_id from canonical_transfer_context), (select cancel_transfer_id from canonical_transfer_context), null, gen_random_uuid());
select public.cancel_inventory_transfer(
  (select organization_id from canonical_transfer_context), (select cancel_transfer_id from canonical_transfer_context), 'No longer needed',
  (select cancel_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select cancel_transfer_id from canonical_transfer_context)), 'cancelled', 'approved transfer can be cancelled before dispatch');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 20::numeric, 'pre-dispatch cancellation is stock-neutral');
select is(
  public.cancel_inventory_transfer(
    (select organization_id from canonical_transfer_context), (select cancel_transfer_id from canonical_transfer_context), 'No longer needed',
    (select cancel_operation_id from canonical_transfer_context)
  ),
  (select cancel_transfer_id from canonical_transfer_context),
  'exact cancellation replay returns the transfer'
);

select public.dispatch_inventory_transfer(
  (select organization_id from canonical_transfer_context), (select transfer_id from canonical_transfer_context), 'Send six',
  (select dispatch_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select transfer_id from canonical_transfer_context)), 'dispatched', 'dispatch advances approved to dispatched');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 14::numeric, 'dispatch deducts source stock once');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 0::numeric, 'dispatch leaves destination stock unchanged');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer' and source_id = (select transfer_id from canonical_transfer_context) and movement_type = 'TRANSFER_OUT'), 1::bigint, 'dispatch writes one TRANSFER_OUT');
select is((select unit_cost_minor from public.stock_transfer_lines where id = (select transfer_line_id from canonical_transfer_context)), (select average_cost_minor from public.inventory_levels where store_id = (select source_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 'dispatch captures current source cost');
select is(
  public.dispatch_inventory_transfer(
    (select organization_id from canonical_transfer_context), (select transfer_id from canonical_transfer_context), 'Send six',
    (select dispatch_operation_id from canonical_transfer_context)
  ),
  (select transfer_id from canonical_transfer_context),
  'exact dispatch replay returns the transfer'
);
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer' and source_id = (select transfer_id from canonical_transfer_context)), 1::bigint, 'dispatch replay does not duplicate ledger movement');
select throws_ok(
  format(
    $$select public.dispatch_inventory_transfer(%L,%L,'Changed dispatch',%L)$$,
    (select organization_id from canonical_transfer_context),
    (select transfer_id from canonical_transfer_context),
    (select dispatch_operation_id from canonical_transfer_context)
  ),
  '23505',
  'This operation ID is already assigned to a different transfer command.',
  'conflicting dispatch replay is rejected'
);
select throws_ok(
  format(
    $$select public.cancel_inventory_transfer(%L,%L,'Too late',gen_random_uuid())$$,
    (select organization_id from canonical_transfer_context),
    (select transfer_id from canonical_transfer_context)
  ),
  '23514',
  'Only a pre-dispatch transfer can be cancelled.',
  'post-dispatch cancellation is rejected'
);

select public.receive_inventory_transfer(
  (select organization_id from canonical_transfer_context),
  (select transfer_id from canonical_transfer_context),
  jsonb_build_array(jsonb_build_object(
    'stock_transfer_line_id', (select transfer_line_id from canonical_transfer_context),
    'received_quantity', '2', 'short_quantity', '1', 'discrepancy_note', 'One unit damaged'
  )),
  'Partial receipt',
  (select partial_receipt_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select transfer_id from canonical_transfer_context)), 'partially_received', 'partial accounting produces partially_received');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 2::numeric, 'partial receipt credits only physical quantity');
select is((select short_quantity from public.stock_transfer_lines where id = (select transfer_line_id from canonical_transfer_context)), 1::numeric, 'short quantity is recorded without stock credit');
select is(
  public.receive_inventory_transfer(
    (select organization_id from canonical_transfer_context),
    (select transfer_id from canonical_transfer_context),
    jsonb_build_array(jsonb_build_object(
      'stock_transfer_line_id', (select transfer_line_id from canonical_transfer_context),
      'received_quantity', '2', 'short_quantity', '1', 'discrepancy_note', 'One unit damaged'
    )),
    'Partial receipt',
    (select partial_receipt_operation_id from canonical_transfer_context)
  ),
  (select result_id from private.stock_transfer_operations where operation_id = (select partial_receipt_operation_id from canonical_transfer_context)),
  'exact receipt replay returns the original receipt'
);
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 2::numeric, 'receipt replay does not duplicate destination credit');
select throws_ok(
  format(
    $$select public.receive_inventory_transfer(%L,%L,%L::jsonb,'Changed receipt',%L)$$,
    (select organization_id from canonical_transfer_context),
    (select transfer_id from canonical_transfer_context),
    jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from canonical_transfer_context), 'received_quantity', '2', 'short_quantity', '1', 'discrepancy_note', 'One unit damaged')),
    (select partial_receipt_operation_id from canonical_transfer_context)
  ),
  '23505',
  'This operation ID is already assigned to a different transfer command.',
  'conflicting receipt replay is rejected'
);

select public.receive_inventory_transfer(
  (select organization_id from canonical_transfer_context),
  (select transfer_id from canonical_transfer_context),
  jsonb_build_array(jsonb_build_object(
    'stock_transfer_line_id', (select transfer_line_id from canonical_transfer_context),
    'received_quantity', '3', 'short_quantity', '0', 'discrepancy_note', null
  )),
  'Final receipt',
  (select final_receipt_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select transfer_id from canonical_transfer_context)), 'received', 'full cumulative accounting produces received');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 5::numeric, 'final destination stock excludes shortage');
select is((select received_quantity from public.stock_transfer_lines where id = (select transfer_line_id from canonical_transfer_context)), 5::numeric, 'physical received quantity is cumulative');
select is((select short_quantity from public.stock_transfer_lines where id = (select transfer_line_id from canonical_transfer_context)), 1::numeric, 'short quantity remains cumulative');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer_receipt' and source_id in (select id from public.stock_transfer_receipts where stock_transfer_id = (select transfer_id from canonical_transfer_context))), 2::bigint, 'two physical receipts write two TRANSFER_IN movements');

select public.record_inventory_adjustment_v3(
  (select organization_id from canonical_transfer_context),
  (select source_store_id from canonical_transfer_context),
  (select product_id from canonical_transfer_context),
  2, 'SEED', 'Seed direct adapter fixture', gen_random_uuid()
);
update canonical_transfer_context
set direct_transfer_id = public.create_direct_stock_transfer(
  organization_id, source_store_id, destination_store_id,
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '2')),
  'Direct adapter transfer', direct_operation_id
);
update canonical_transfer_context
set direct_transfer_line_id = (select id from public.stock_transfer_lines where stock_transfer_id = canonical_transfer_context.direct_transfer_id);
select is((select status from public.stock_transfers where id = (select direct_transfer_id from canonical_transfer_context)), 'dispatched', 'direct Send transfer adapter ends in dispatched');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 14::numeric, 'direct adapter deducts source exactly once');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 5::numeric, 'direct adapter does not credit destination');

reset role;
delete from private.stock_transfer_operations where stock_transfer_id = (select direct_transfer_id from canonical_transfer_context);
set local role authenticated;
set local request.jwt.claim.sub = '95959595-9595-4959-8959-959595959595';
select is(
  public.create_direct_stock_transfer(
    (select organization_id from canonical_transfer_context),
    (select source_store_id from canonical_transfer_context),
    (select destination_store_id from canonical_transfer_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from canonical_transfer_context), 'variant_id', null, 'quantity', '2')),
    'Direct adapter transfer',
    (select direct_operation_id from canonical_transfer_context)
  ),
  (select direct_transfer_id from canonical_transfer_context),
  'historical direct retry returns the existing transfer'
);
select is((select count(*) from private.stock_transfer_operations where stock_transfer_id = (select direct_transfer_id from canonical_transfer_context)), 0::bigint, 'historical direct retry does not fabricate transition operations');

select public.receive_stock_transfer(
  (select organization_id from canonical_transfer_context),
  (select direct_transfer_id from canonical_transfer_context),
  jsonb_build_array(jsonb_build_object(
    'stock_transfer_line_id', (select direct_transfer_line_id from canonical_transfer_context),
    'received_quantity', '2', 'short_quantity', '0', 'discrepancy_note', null
  )),
  'Direct adapter receipt',
  (select direct_receipt_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select direct_transfer_id from canonical_transfer_context)), 'received', 'direct receipt adapter reaches canonical received');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from canonical_transfer_context) and product_id = (select product_id from canonical_transfer_context)), 7::numeric, 'direct receipt adapter credits destination once');

reset role;
delete from private.stock_transfer_operations where operation_id = (select direct_receipt_operation_id from canonical_transfer_context);
set local role authenticated;
set local request.jwt.claim.sub = '95959595-9595-4959-8959-959595959595';
select is(
  public.receive_stock_transfer(
    (select organization_id from canonical_transfer_context),
    (select direct_transfer_id from canonical_transfer_context),
    jsonb_build_array(jsonb_build_object(
      'stock_transfer_line_id', (select direct_transfer_line_id from canonical_transfer_context),
      'received_quantity', '2', 'short_quantity', '0', 'discrepancy_note', null
    )),
    'Direct adapter receipt',
    (select direct_receipt_operation_id from canonical_transfer_context)
  ),
  (select id from public.stock_transfer_receipts where operation_id = (select direct_receipt_operation_id from canonical_transfer_context)),
  'historical receipt retry returns the original receipt'
);
select is((select count(*) from private.stock_transfer_operations where operation_id = (select direct_receipt_operation_id from canonical_transfer_context)), 0::bigint, 'historical receipt replay does not fabricate registry history');

update canonical_transfer_context
set warehouse_id = public.create_supply_chain_warehouse(organization_id, source_store_id, 'CANONICAL-REQUEST-SOURCE', 'Canonical request source', 'Legacy request flow');
update canonical_transfer_context
set request_id = public.create_stock_request(
  organization_id, destination_store_id, warehouse_id, 'Legacy request compatibility',
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '4')),
  request_operation_id
);
update canonical_transfer_context
set request_line_id = (select id from public.stock_request_lines where stock_request_id = canonical_transfer_context.request_id);
select public.approve_stock_request(
  (select organization_id from canonical_transfer_context),
  (select request_id from canonical_transfer_context),
  jsonb_build_array(jsonb_build_object('stock_request_line_id', (select request_line_id from canonical_transfer_context), 'approved_quantity', '4'))
);
select public.start_stock_request_picking((select organization_id from canonical_transfer_context), (select request_id from canonical_transfer_context));
update canonical_transfer_context
set request_transfer_id = public.dispatch_stock_request(organization_id, request_id, 'Legacy request dispatch', request_dispatch_operation_id);
update canonical_transfer_context
set request_transfer_line_id = (select id from public.stock_transfer_lines where stock_transfer_id = canonical_transfer_context.request_transfer_id);
select is((select status from public.stock_requests where id = (select request_id from canonical_transfer_context)), 'dispatched', 'request document records dispatch');
select is((select status from public.stock_transfers where id = (select request_transfer_id from canonical_transfer_context)), 'dispatched', 'request dispatch produces a canonical dispatched physical transfer');
select public.receive_stock_request(
  (select organization_id from canonical_transfer_context),
  (select request_id from canonical_transfer_context),
  jsonb_build_array(jsonb_build_object(
    'stock_transfer_line_id', (select request_transfer_line_id from canonical_transfer_context),
    'received_quantity', '4', 'short_quantity', '0', 'discrepancy_note', null
  )),
  'Legacy request receipt',
  (select request_receipt_operation_id from canonical_transfer_context)
);
select is((select status from public.stock_transfers where id = (select request_transfer_id from canonical_transfer_context)), 'received', 'request final receipt produces a canonical received physical transfer');
select is((select status from public.stock_requests where id = (select request_id from canonical_transfer_context)), 'received', 'request workflow still completes unchanged');

reset role;
select throws_ok(
  format(
    $$update public.stock_transfers set status = 'unknown_state' where id = %L$$,
    (select transfer_id from canonical_transfer_context)
  ),
  '23514',
  null,
  'unknown transfer states are rejected'
);

select * from finish();
rollback;
