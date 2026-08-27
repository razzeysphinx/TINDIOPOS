begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_column('public', 'payment_methods', 'offline_policy', 'payment methods have an explicit offline settlement policy');
select has_table('public', 'offline_sync_events', 'server-observed offline synchronization events table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.offline_sync_events'::regclass), 'offline synchronization events use RLS');
select ok(not has_table_privilege('authenticated', 'public.offline_sync_events', 'insert'), 'clients cannot insert offline synchronization events directly');
select ok(to_regprocedure('public.set_payment_method_offline_policy(uuid,uuid,text)') is not null, 'offline payment policy function exists');
select ok(to_regprocedure('public.record_offline_sync_event(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,bigint)') is not null, 'offline synchronization event function exists');
select ok(has_function_privilege('authenticated', 'public.record_offline_sync_event(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,bigint)', 'execute'), 'authenticated POS users can report a validated synchronization outcome');
select ok(not has_function_privilege('anon', 'public.record_offline_sync_event(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,bigint)', 'execute'), 'anonymous callers cannot report synchronization outcomes');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'offline_sync_events_organization_state_attempt_idx'), 'offline issue lookup has an organization and state index');
select ok(to_regprocedure('private.guard_offline_payment_total_marker()') is not null, 'offline payment total guard function exists');
select ok(exists (select 1 from pg_catalog.pg_trigger where tgname = 'guard_offline_payment_total_marker' and tgrelid = 'public.payments'::regclass), 'offline payment total guard is attached to final payment inserts');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('f1300000-0000-4000-8000-000000000001', 'offline-owner@tindio.test', '{"full_name":"Offline Owner"}'::jsonb),
  ('f1300000-0000-4000-8000-000000000002', 'offline-outsider@tindio.test', '{"full_name":"Offline Outsider"}'::jsonb);

create temporary table offline_sync_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  cash_method_id uuid,
  wallet_method_id uuid,
  product_id uuid,
  primary_shift_id uuid,
  second_register_id uuid,
  second_shift_id uuid,
  primary_device_id uuid,
  second_device_id uuid,
  sale_id uuid,
  receipt_number bigint,
  replay_sale_id uuid,
  replay_was_replayed boolean
);
grant select, insert, update on offline_sync_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'f1300000-0000-4000-8000-000000000001';

insert into offline_sync_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Offline Foundation Retail', 'Offline Foundation Main', 'Offline Foundation Counter');

update offline_sync_context
set cash_method_id = public.create_store_scoped_payment_method(
  organization_id,
  'Offline Cash',
  'OFFLINE_CASH',
  'CASH',
  false,
  array[store_id]
);

select is(
  (select offline_policy from public.payment_methods where id = (select cash_method_id from offline_sync_context)),
  'cash',
  'a newly created Cash method is automatically approved for offline cash settlement'
);

update offline_sync_context
set wallet_method_id = public.create_store_scoped_payment_method(
  organization_id,
  'Manual Wallet',
  'MANUAL_WALLET',
  'E_WALLET',
  true,
  array[store_id]
);

select lives_ok(
  format(
    $$select public.set_payment_method_offline_policy(%L, %L, 'manual_external')$$,
    (select organization_id from offline_sync_context),
    (select wallet_method_id from offline_sync_context)
  ),
  'settings manager can configure an explicit manual external policy'
);
select is(
  (select offline_policy from public.payment_methods where id = (select wallet_method_id from offline_sync_context)),
  'manual_external',
  'manual external policy is persisted separately from payment category'
);
select throws_ok(
  format(
    $$select public.set_payment_method_offline_policy(%L, %L, 'cash')$$,
    (select organization_id from offline_sync_context),
    (select wallet_method_id from offline_sync_context)
  ),
  '23514',
  'Only cash methods can be settled automatically while offline.',
  'a non-cash method cannot be falsely marked as automatic offline cash'
);

select lives_ok(
  format(
    $$select public.record_offline_sync_event(%L, %L, %L, null, null, 'f1300000-0000-4000-8000-000000000099', 'OFF-13TEST01', now(), 'CONFLICT', 'PRICE_CHANGED', 'The queued sale total changed while offline.', null)$$,
    (select organization_id from offline_sync_context),
    (select store_id from offline_sync_context),
    (select register_id from offline_sync_context)
  ),
  'assigned POS employee can record a deterministic server-observed offline conflict'
);
select is(
  (select state from public.offline_sync_events where local_receipt_reference = 'OFF-13TEST01'),
  'CONFLICT',
  'offline conflict state is retained for manager review'
);
select is(
  (select conflict_type from public.offline_sync_events where local_receipt_reference = 'OFF-13TEST01'),
  'PRICE_CHANGED',
  'offline conflict classification is retained for manager review'
);

update offline_sync_context
set product_id = public.create_catalog_product_v2(
  organization_id,
  null,
  'Phase 8 Offline Replay Item',
  'Tracked item for exactly-once offline synchronization coverage',
  'simple',
  'PHASE8-OFFLINE-ITEM',
  '480000013008',
  1200,
  400,
  true,
  'each',
  array[store_id],
  '[]'::jsonb,
  '',
  false,
  false
);

select lives_ok(
  format(
    $$select public.adjust_inventory(%L, %L, %L, null, 5, 'OPENING_STOCK', 'Phase 8 offline replay stock')$$,
    (select organization_id from offline_sync_context),
    (select store_id from offline_sync_context),
    (select product_id from offline_sync_context)
  ),
  'offline replay coverage starts with tracked stock'
);

set local role postgres;
with second_register as (
  insert into public.registers (organization_id, store_id, name, code)
  select organization_id, store_id, 'Offline Foundation Counter Two', 'OFFLINE-02'
  from offline_sync_context
  returning id
)
update offline_sync_context context
set second_register_id = second_register.id
from second_register;
set local role authenticated;
set local request.jwt.claim.sub = 'f1300000-0000-4000-8000-000000000001';

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, 'Phase 8 primary offline shift')$$,
    (select organization_id from offline_sync_context),
    (select store_id from offline_sync_context),
    (select register_id from offline_sync_context)
  ),
  'primary register opens the shift used by the queued sale'
);
update offline_sync_context context
set primary_shift_id = shift.id
from public.shifts shift
where shift.organization_id = context.organization_id
  and shift.register_id = context.register_id
  and shift.status = 'open';

set local role postgres;
insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'f1300000-0000-4000-8000-000000000002', 'OFFLINE-SHIFT-002', 'Cashier'
from offline_sync_context;
insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.store_id
from offline_sync_context context
join public.employees employee
  on employee.organization_id = context.organization_id
 and employee.profile_id = 'f1300000-0000-4000-8000-000000000002';
insert into public.shifts (
  organization_id,
  store_id,
  register_id,
  opened_by_employee_id,
  opening_cash_minor,
  opening_note
)
select
  context.organization_id,
  context.store_id,
  context.second_register_id,
  employee.id,
  0,
  'Phase 8 secondary offline shift'
from offline_sync_context context
join public.employees employee
  on employee.organization_id = context.organization_id
 and employee.profile_id = 'f1300000-0000-4000-8000-000000000002';
update offline_sync_context context
set second_shift_id = shift.id
from public.shifts shift
where shift.organization_id = context.organization_id
  and shift.register_id = context.second_register_id
  and shift.status = 'open';
select ok(
  (select second_shift_id is not null from offline_sync_context),
  'a second register shift exists for binding-rejection coverage'
);

insert into public.pos_devices (
  id,
  organization_id,
  store_id,
  register_id,
  name,
  registered_by_employee_id
)
select
  'f1300000-0000-4000-8000-000000000110',
  context.organization_id,
  context.store_id,
  context.register_id,
  'Phase 8 primary telemetry device',
  employee.id
from offline_sync_context context
join public.employees employee
  on employee.organization_id = context.organization_id
 and employee.profile_id = 'f1300000-0000-4000-8000-000000000001';

insert into public.pos_devices (
  id,
  organization_id,
  store_id,
  register_id,
  name,
  registered_by_employee_id
)
select
  'f1300000-0000-4000-8000-000000000111',
  context.organization_id,
  context.store_id,
  context.second_register_id,
  'Phase 8 secondary telemetry device',
  employee.id
from offline_sync_context context
join public.employees employee
  on employee.organization_id = context.organization_id
 and employee.profile_id = 'f1300000-0000-4000-8000-000000000001';

update offline_sync_context
set
  primary_device_id = 'f1300000-0000-4000-8000-000000000110',
  second_device_id = 'f1300000-0000-4000-8000-000000000111';
set local role authenticated;
set local request.jwt.claim.sub = 'f1300000-0000-4000-8000-000000000001';

update offline_sync_context context
set (sale_id, receipt_number) = (
  select checkout.sale_id, checkout.receipt_number
  from public.checkout_advanced_sale(
    context.organization_id,
    context.store_id,
    context.register_id,
    'f1300000-0000-4000-8000-000000000120',
    jsonb_build_array(jsonb_build_object(
      'product_id', context.product_id,
      'variant_id', null,
      'quantity', 1,
      'modifier_option_ids', '[]'::jsonb
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', context.cash_method_id,
      'amount_tendered_minor', 1200,
      'note', '[tindio-offline-total:1200]'
    )),
    null,
    0,
    null,
    null,
    null,
    null
  ) checkout
);

update offline_sync_context context
set (replay_sale_id, replay_was_replayed) = (
  select checkout.sale_id, checkout.was_replayed
  from public.checkout_advanced_sale(
    context.organization_id,
    context.store_id,
    context.register_id,
    'f1300000-0000-4000-8000-000000000120',
    jsonb_build_array(jsonb_build_object(
      'product_id', context.product_id,
      'variant_id', null,
      'quantity', 1,
      'modifier_option_ids', '[]'::jsonb
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', context.cash_method_id,
      'amount_tendered_minor', 1200,
      'note', '[tindio-offline-total:1200]'
    )),
    null,
    0,
    null,
    null,
    null,
    null
  ) checkout
);

select is(
  (select replay_sale_id from offline_sync_context),
  (select sale_id from offline_sync_context),
  'reconnecting the same stable checkout UUID returns the original sale'
);
select ok(
  (select replay_was_replayed from offline_sync_context),
  'reconnecting the same stable checkout UUID is reported as a replay'
);
set local role postgres;
select is(
  (select count(*) from public.advanced_checkout_requests where organization_id = (select organization_id from offline_sync_context) and idempotency_key = 'f1300000-0000-4000-8000-000000000120'),
  1::bigint,
  'one checkout request survives the automatic retry'
);
select is(
  (select count(*) from public.sales where id = (select sale_id from offline_sync_context)),
  1::bigint,
  'automatic retry creates exactly one sale'
);
select is(
  (select count(*) from public.payments where sale_id = (select sale_id from offline_sync_context)),
  1::bigint,
  'automatic retry creates exactly one payment'
);
select is(
  (select count(*) from public.inventory_movements where organization_id = (select organization_id from offline_sync_context) and store_id = (select store_id from offline_sync_context) and product_id = (select product_id from offline_sync_context) and movement_type = 'SALE'),
  1::bigint,
  'automatic retry creates exactly one inventory movement'
);
select is(
  (select count(*) from public.receipts where sale_id = (select sale_id from offline_sync_context)),
  1::bigint,
  'automatic retry creates exactly one receipt'
);
set local role authenticated;
set local request.jwt.claim.sub = 'f1300000-0000-4000-8000-000000000001';

select lives_ok(
  format(
    $$select public.record_offline_sync_event(%L, %L, %L, %L, %L, 'f1300000-0000-4000-8000-000000000121', 'OFF-13PHASE8', now(), 'SYNCED', null, null, %L)$$,
    (select organization_id from offline_sync_context),
    (select store_id from offline_sync_context),
    (select register_id from offline_sync_context),
    (select primary_shift_id from offline_sync_context),
    (select primary_device_id from offline_sync_context),
    (select receipt_number from offline_sync_context)
  ),
  'offline sync telemetry accepts the queued sale shift and device bound to its register'
);
select lives_ok(
  format(
    $$select public.record_offline_sync_event(%L, %L, %L, %L, %L, 'f1300000-0000-4000-8000-000000000121', 'OFF-13PHASE8', now(), 'SYNCED', null, null, %L)$$,
    (select organization_id from offline_sync_context),
    (select store_id from offline_sync_context),
    (select register_id from offline_sync_context),
    (select primary_shift_id from offline_sync_context),
    (select primary_device_id from offline_sync_context),
    (select receipt_number from offline_sync_context)
  ),
  'repeated offline sync telemetry updates its one durable event'
);
select is(
  (select count(*) from public.offline_sync_events where organization_id = (select organization_id from offline_sync_context) and idempotency_key = 'f1300000-0000-4000-8000-000000000121'),
  1::bigint,
  'one telemetry event represents repeated delivery of one queued sale'
);
select is(
  (select attempt_count from public.offline_sync_events where organization_id = (select organization_id from offline_sync_context) and idempotency_key = 'f1300000-0000-4000-8000-000000000121'),
  2,
  'repeated telemetry delivery preserves its attempt count'
);
select ok(
  exists (
    select 1
    from public.offline_sync_events event
    join offline_sync_context context on context.organization_id = event.organization_id
    where event.idempotency_key = 'f1300000-0000-4000-8000-000000000121'
      and event.store_id = context.store_id
      and event.register_id = context.register_id
      and event.shift_id = context.primary_shift_id
      and event.device_id = context.primary_device_id
  ),
  'telemetry retains the store, register, shift, and device of the queued sale'
);
select throws_ok(
  format(
    $$select public.record_offline_sync_event(%L, %L, %L, %L, %L, 'f1300000-0000-4000-8000-000000000122', 'OFF-13SHIFTX', now(), 'CONFLICT', 'INVALID_SHIFT', 'The client supplied a mismatched shift.', null)$$,
    (select organization_id from offline_sync_context),
    (select store_id from offline_sync_context),
    (select register_id from offline_sync_context),
    (select second_shift_id from offline_sync_context),
    (select primary_device_id from offline_sync_context)
  ),
  '23514',
  'The offline sale shift is not valid for this store and register.',
  'offline telemetry rejects a shift from a different register'
);
select throws_ok(
  format(
    $$select public.record_offline_sync_event(%L, %L, %L, %L, %L, 'f1300000-0000-4000-8000-000000000123', 'OFF-13DEVICEX', now(), 'CONFLICT', 'DEVICE_REVOKED', 'The client supplied a mismatched device.', null)$$,
    (select organization_id from offline_sync_context),
    (select store_id from offline_sync_context),
    (select register_id from offline_sync_context),
    (select primary_shift_id from offline_sync_context),
    (select second_device_id from offline_sync_context)
  ),
  '23514',
  'The offline sale device is not bound to this store and register.',
  'offline telemetry rejects a device from a different register'
);

set local request.jwt.claim.sub = 'f1300000-0000-4000-8000-000000000002';
select is(
  (select count(*) from public.offline_sync_events where organization_id = (select organization_id from offline_sync_context)),
  0::bigint,
  'an unrelated user cannot read offline synchronization history'
);

select * from finish();
rollback;
