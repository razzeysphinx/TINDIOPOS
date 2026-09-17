begin;

create extension if not exists pgtap with schema extensions;
select plan(50);

select ok(to_regprocedure('private.dispatch_inventory_transfer_core(uuid,uuid,text,uuid,boolean)') is not null, 'shared physical dispatch core exists');
select ok(to_regprocedure('private.receive_inventory_transfer_core(uuid,uuid,jsonb,text,uuid,boolean)') is not null, 'shared physical receipt core exists');
select ok(to_regprocedure('private.migrate_legacy_stock_transfer_statuses()') is not null, 'historical status migration routine exists');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.stock_transfers'::regclass and conname = 'stock_transfers_status_values') like all
  (array['%draft%', '%submitted%', '%approved%', '%dispatched%', '%partially_received%', '%received%', '%cancelled%']), 'final constraint contains seven canonical states');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.stock_transfers'::regclass and conname = 'stock_transfers_status_values') not like all
  (array['%in_transit%', '%completed%']), 'final constraint excludes legacy states');

insert into auth.users (id, email, raw_user_meta_data)
values ('c6060606-0606-4606-8606-060606060606', 'phase06-request-transfer@tindio.test', '{"full_name":"Phase 06 Request Transfer"}'::jsonb);

create temporary table phase_06_context (
  organization_id uuid, source_store_id uuid, destination_store_id uuid, register_id uuid,
  product_id uuid, warehouse_id uuid, request_id uuid, request_line_id uuid,
  transfer_id uuid, transfer_line_id uuid,
  request_operation_id uuid default 'c6000000-0000-4000-8000-000000000001',
  dispatch_operation_id uuid default 'c6000000-0000-4000-8000-000000000002',
  partial_operation_id uuid default 'c6000000-0000-4000-8000-000000000003',
  final_operation_id uuid default 'c6000000-0000-4000-8000-000000000004'
);
grant select, insert, update on phase_06_context to authenticated;
grant select on private.stock_transfer_operations, public.inventory_levels, public.inventory_movements,
  public.stock_transfer_lines, public.stock_transfer_receipts, public.stock_request_discrepancies to authenticated;
grant execute on function private.inventory_transfer_child_operation_id(uuid,text) to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'c6060606-0606-4606-8606-060606060606';
insert into phase_06_context (organization_id, source_store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Phase 06 Request Canonical', 'Request Source', 'Request Counter');

with destination as (
  insert into public.stores (organization_id, name, code)
  values ((select organization_id from phase_06_context), 'Request Destination', 'P06-DEST') returning id
)
update phase_06_context set destination_store_id = destination.id from destination;

insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.destination_store_id
from phase_06_context context join public.employees employee on employee.organization_id = context.organization_id
where employee.profile_id = auth.uid();

update phase_06_context set product_id = public.create_catalog_product(
  organization_id, null, 'Phase 06 Item', 'Canonical request item', 'simple', 'PHASE06-ITEM',
  '480000006060', 2500, 1000, true, 'each', array[source_store_id, destination_store_id], '[]'::jsonb
);
select public.create_inventory_adjustment_reason((select organization_id from phase_06_context), 'P06_SEED', 'Phase 06 seed', 'ADJUSTMENT');
select public.record_inventory_adjustment_v3((select organization_id from phase_06_context),
  (select source_store_id from phase_06_context), (select product_id from phase_06_context),
  20, 'P06_SEED', 'Seed request source', 'c6000000-0000-4000-8000-000000000010');
update phase_06_context set warehouse_id = public.create_supply_chain_warehouse(
  organization_id, source_store_id, 'P06-WAREHOUSE', 'Phase 06 warehouse', 'Canonical request source');
update phase_06_context set request_id = public.create_stock_request(
  organization_id, destination_store_id, warehouse_id, 'Canonical request',
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '4')),
  request_operation_id);
update phase_06_context set request_line_id = (select id from public.stock_request_lines where stock_request_id = phase_06_context.request_id);

select is((select status from public.stock_requests where id = (select request_id from phase_06_context)), 'requested', 'request begins requested');
select is((select count(*) from public.stock_transfers where stock_request_id = (select request_id from phase_06_context)), 0::bigint, 'request creation is physically neutral');
select public.approve_stock_request((select organization_id from phase_06_context), (select request_id from phase_06_context),
  jsonb_build_array(jsonb_build_object('stock_request_line_id', (select request_line_id from phase_06_context), 'approved_quantity', '4')));
select is((select status from public.stock_requests where id = (select request_id from phase_06_context)), 'approved', 'request approval remains request-specific');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from phase_06_context) and product_id = (select product_id from phase_06_context)), 20::numeric, 'approval is stock-neutral');
select public.start_stock_request_picking((select organization_id from phase_06_context), (select request_id from phase_06_context));
select is((select status from public.stock_requests where id = (select request_id from phase_06_context)), 'picking', 'request enters picking');

update phase_06_context set transfer_id = public.dispatch_stock_request(organization_id, request_id, 'Canonical dispatch', dispatch_operation_id);
update phase_06_context set transfer_line_id = (select id from public.stock_transfer_lines where stock_transfer_id = phase_06_context.transfer_id);
select ok((select transfer_id is not null from phase_06_context), 'dispatch materializes one physical transfer');
select is((select status from public.stock_requests where id = (select request_id from phase_06_context)), 'dispatched', 'request becomes dispatched');
select is((select status from public.stock_transfers where id = (select transfer_id from phase_06_context)), 'dispatched', 'physical transfer becomes dispatched');
select is((select stock_request_id from public.stock_transfers where id = (select transfer_id from phase_06_context)), (select request_id from phase_06_context), 'physical transfer links to request');
select is((select quantity from public.inventory_levels where store_id = (select source_store_id from phase_06_context) and product_id = (select product_id from phase_06_context)), 16::numeric, 'dispatch deducts source exactly once');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from phase_06_context) and product_id = (select product_id from phase_06_context)), 0::numeric, 'dispatch leaves destination unchanged');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer' and source_id = (select transfer_id from phase_06_context) and movement_type = 'TRANSFER_OUT'), 1::bigint, 'dispatch writes one source movement');
select is(
  (select unit_cost_is_known from public.stock_transfer_lines where id = (select transfer_line_id from phase_06_context)),
  (select cost_is_known from public.inventory_levels where store_id = (select source_store_id from phase_06_context) and product_id = (select product_id from phase_06_context)),
  'dispatch captures the source cost-known truth'
);
select is((select count(*) from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_06_context)), 4::bigint, 'request dispatch records four canonical operations');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_06_context) and command = 'create'), (select dispatch_operation_id from phase_06_context), 'create uses external dispatch operation ID');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_06_context) and command = 'submit'), private.inventory_transfer_child_operation_id((select dispatch_operation_id from phase_06_context), 'submit'), 'submit uses deterministic child ID');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_06_context) and command = 'approve'), private.inventory_transfer_child_operation_id((select dispatch_operation_id from phase_06_context), 'approve'), 'approve uses deterministic child ID');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_06_context) and command = 'dispatch'), private.inventory_transfer_child_operation_id((select dispatch_operation_id from phase_06_context), 'dispatch'), 'dispatch uses deterministic child ID');
select is(public.dispatch_stock_request((select organization_id from phase_06_context), (select request_id from phase_06_context), 'Canonical dispatch', (select dispatch_operation_id from phase_06_context)), (select transfer_id from phase_06_context), 'exact dispatch retry returns original transfer');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer' and source_id = (select transfer_id from phase_06_context) and movement_type = 'TRANSFER_OUT'), 1::bigint, 'dispatch replay creates no second deduction');
select throws_ok(format($$select public.dispatch_stock_request(%L,%L,'Changed dispatch',%L)$$,
  (select organization_id from phase_06_context), (select request_id from phase_06_context), (select dispatch_operation_id from phase_06_context)),
  '23505', 'This operation ID is already assigned to a different transfer dispatch.', 'conflicting dispatch retry is rejected');

select is(public.receive_stock_request((select organization_id from phase_06_context), (select request_id from phase_06_context),
  jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from phase_06_context),
    'received_quantity', '2', 'short_quantity', '0', 'discrepancy_note', null)), 'Partial receipt', (select partial_operation_id from phase_06_context)),
  (select request_id from phase_06_context), 'partial request receipt succeeds');
select is((select status from public.stock_transfers where id = (select transfer_id from phase_06_context)), 'partially_received', 'physical transfer becomes partially received');
select is((select status from public.stock_requests where id = (select request_id from phase_06_context)), 'partially_received', 'request becomes partially received');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from phase_06_context) and product_id = (select product_id from phase_06_context)), 2::numeric, 'partial receipt credits physical quantity only');

select is(public.receive_stock_request((select organization_id from phase_06_context), (select request_id from phase_06_context),
  jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from phase_06_context),
    'received_quantity', '0', 'short_quantity', '2', 'discrepancy_note', 'Two units missing')), 'Final shortage', (select final_operation_id from phase_06_context)),
  (select request_id from phase_06_context), 'final shortage receipt succeeds');
select is((select status from public.stock_requests where id = (select request_id from phase_06_context)), 'received_with_discrepancy', 'request preserves discrepancy terminal state');
select is((select status from public.stock_transfers where id = (select transfer_id from phase_06_context)), 'received', 'physical transfer terminates received');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from phase_06_context) and product_id = (select product_id from phase_06_context)), 2::numeric, 'shortage creates no destination stock');
select is((select short_quantity from public.stock_transfer_lines where id = (select transfer_line_id from phase_06_context)), 2::numeric, 'transfer line records shortage');
select is((select short_quantity from public.stock_request_lines where id = (select request_line_id from phase_06_context)), 2::numeric, 'request line records shortage');
select is((select count(*) from public.stock_request_discrepancies where stock_request_id = (select request_id from phase_06_context)), 1::bigint, 'one discrepancy row records shortage');
select is((select count(*) from public.stock_transfer_receipts where stock_transfer_id = (select transfer_id from phase_06_context)), 2::bigint, 'immutable receipt history contains both receipts');
select is(public.receive_stock_request((select organization_id from phase_06_context), (select request_id from phase_06_context),
  jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from phase_06_context),
    'received_quantity', '0', 'short_quantity', '2', 'discrepancy_note', 'Two units missing')), 'Final shortage', (select final_operation_id from phase_06_context)),
  (select request_id from phase_06_context), 'exact receipt retry returns original request result');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from phase_06_context) and product_id = (select product_id from phase_06_context)), 2::numeric, 'receipt replay creates no stock effect');
select throws_ok(format($$select public.receive_stock_request(%L,%L,%L::jsonb,'Changed receipt',%L)$$,
  (select organization_id from phase_06_context), (select request_id from phase_06_context),
  jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from phase_06_context), 'received_quantity', '0', 'short_quantity', '2', 'discrepancy_note', 'Two units missing')),
  (select final_operation_id from phase_06_context)), '23505', 'This operation ID is already assigned to a different transfer receipt.', 'conflicting receipt retry is rejected');

reset role;
select throws_ok(format($$update public.stock_transfers set status = 'in_transit' where id = %L$$, (select transfer_id from phase_06_context)), '23514', null, 'legacy in_transit state is rejected');
select throws_ok(format($$update public.stock_transfers set status = 'completed' where id = %L$$, (select transfer_id from phase_06_context)), '23514', null, 'legacy completed state is rejected');
select ok(pg_get_functiondef('public.get_pos_incoming_stock_transfers(uuid)'::regprocedure) ~ $$status in \('dispatched', 'partially_received'\)$$, 'POS projection accepts canonical open physical states');
select ok(pg_get_functiondef('public.get_pos_incoming_stock_transfers(uuid)'::regprocedure) !~ $$in_transit|completed$$, 'POS projection excludes legacy physical states');

-- Exercise the actual migration routine against representative pre-Phase-06
-- rows inside this rolled-back test transaction.
alter table phase_06_context add column legacy_active_id uuid;
alter table phase_06_context add column legacy_completed_id uuid;
alter table phase_06_context add column legacy_partial_id uuid;
alter table phase_06_context add column legacy_unsafe_id uuid;
alter table public.stock_transfers drop constraint stock_transfers_received_state;
alter table public.stock_transfers drop constraint stock_transfers_status_values;
alter table public.stock_transfers add constraint stock_transfers_status_values check (
  status in ('draft','submitted','approved','dispatched','partially_received','received','cancelled','in_transit','completed')
);

with actor as (select id from public.employees where organization_id = (select organization_id from phase_06_context) limit 1), inserted as (
  insert into public.stock_transfers (organization_id, transfer_number, operation_id, source_store_id, destination_store_id, status, note, transferred_by_employee_id)
  select organization_id, nextval('private.tindio_stock_transfer_number_sequence'), 'c6000000-0000-4000-8000-000000000021', source_store_id, destination_store_id, 'in_transit', 'Safe legacy active', actor.id from phase_06_context, actor returning id
) update phase_06_context set legacy_active_id = inserted.id from inserted;
with actor as (select id from public.employees where organization_id = (select organization_id from phase_06_context) limit 1), inserted as (
  insert into public.stock_transfers (organization_id, transfer_number, operation_id, source_store_id, destination_store_id, status, note, transferred_by_employee_id, completed_at)
  select organization_id, nextval('private.tindio_stock_transfer_number_sequence'), 'c6000000-0000-4000-8000-000000000022', source_store_id, destination_store_id, 'completed', 'Safe legacy terminal', actor.id, now() from phase_06_context, actor returning id
) update phase_06_context set legacy_completed_id = inserted.id from inserted;
with actor as (select id from public.employees where organization_id = (select organization_id from phase_06_context) limit 1), inserted as (
  insert into public.stock_transfers (organization_id, transfer_number, operation_id, source_store_id, destination_store_id, status, note, transferred_by_employee_id, received_by_employee_id, received_at)
  select organization_id, nextval('private.tindio_stock_transfer_number_sequence'), 'c6000000-0000-4000-8000-000000000023', source_store_id, destination_store_id, 'partially_received', 'Safe legacy partial', actor.id, actor.id, now() from phase_06_context, actor returning id
) update phase_06_context set legacy_partial_id = inserted.id from inserted;
with actor as (select id from public.employees where organization_id = (select organization_id from phase_06_context) limit 1), inserted as (
  insert into public.stock_transfers (organization_id, transfer_number, operation_id, source_store_id, destination_store_id, status, note, transferred_by_employee_id, completed_at)
  select organization_id, nextval('private.tindio_stock_transfer_number_sequence'), 'c6000000-0000-4000-8000-000000000024', source_store_id, destination_store_id, 'completed', 'Unsafe legacy terminal', actor.id, now() from phase_06_context, actor returning id
) update phase_06_context set legacy_unsafe_id = inserted.id from inserted;

insert into public.stock_transfer_lines (organization_id, stock_transfer_id, product_id, variant_id, quantity, received_quantity, short_quantity, unit_cost_minor)
select organization_id, legacy_active_id, product_id, null::uuid, 2, 0, 0, 500 from phase_06_context
union all select organization_id, legacy_completed_id, product_id, null::uuid, 3, 3, 0, 500 from phase_06_context
union all select organization_id, legacy_partial_id, product_id, null::uuid, 4, 1, 0, 500 from phase_06_context
union all select organization_id, legacy_unsafe_id, product_id, null::uuid, 3, 1, 0, 500 from phase_06_context;

select throws_ok('select private.migrate_legacy_stock_transfer_statuses()', '23514',
  'Unsafe completed transfer history blocks canonical status cleanup.', 'ambiguous terminal legacy history fails closed');
delete from public.stock_transfer_lines where stock_transfer_id = (select legacy_unsafe_id from phase_06_context);
delete from public.stock_transfers where id = (select legacy_unsafe_id from phase_06_context);
select private.migrate_legacy_stock_transfer_statuses();
select is((select status from public.stock_transfers where id = (select legacy_active_id from phase_06_context)), 'dispatched', 'safe legacy in_transit maps to dispatched');
select is((select status from public.stock_transfers where id = (select legacy_completed_id from phase_06_context)), 'received', 'safe legacy completed maps to received');
select is((select status from public.stock_transfers where id = (select legacy_partial_id from phase_06_context)), 'partially_received', 'legacy partial remains partially received');
select ok((select received_by_employee_id is not null and received_at is not null from public.stock_transfers where id = (select legacy_completed_id from phase_06_context)), 'safe historical terminal mapping preserves deterministic receipt metadata');

select * from finish();
rollback;
