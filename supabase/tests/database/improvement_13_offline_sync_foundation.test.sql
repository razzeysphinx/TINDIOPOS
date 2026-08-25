begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

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
  wallet_method_id uuid
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

set local request.jwt.claim.sub = 'f1300000-0000-4000-8000-000000000002';
select is(
  (select count(*) from public.offline_sync_events where organization_id = (select organization_id from offline_sync_context)),
  0::bigint,
  'an unrelated user cannot read offline synchronization history'
);

select * from finish();
rollback;
