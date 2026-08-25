begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select ok(to_regclass('public.customer_display_sessions') is not null, 'customer display session table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.customer_display_sessions'::regclass), 'customer display sessions have RLS enabled');
select ok(to_regclass('public.customer_display_sessions_active_register_unique_idx') is not null, 'one active display session is enforced per register');
select ok(to_regprocedure('public.provision_customer_display_session(uuid,uuid,text,text)') is not null, 'display provisioning routine exists');
select ok(to_regprocedure('public.get_customer_display_bootstrap(text)') is not null, 'customer display bootstrap routine exists');
select ok(to_regprocedure('public.get_pos_customer_display_sessions_with_ids(uuid)') is not null, 'POS display lookup routine exists');
select ok(not has_table_privilege('anon', 'public.customer_display_sessions', 'select'), 'anonymous users cannot select display sessions');
select ok(not has_table_privilege('authenticated', 'public.customer_display_sessions', 'select'), 'authenticated users cannot select display sessions directly');
select ok(has_function_privilege('anon', 'public.get_customer_display_bootstrap(text)', 'execute'), 'anonymous paired screens can call only the bootstrap routine');
select ok(not has_function_privilege('anon', 'public.set_customer_display_state(uuid,uuid,jsonb)', 'execute'), 'anonymous callers cannot publish display state');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('b1111111-1111-4111-8111-111111111111', 'display-owner@tindio.test', '{"full_name":"Display Owner"}'::jsonb),
  ('b2222222-2222-4222-8222-222222222222', 'display-outsider@tindio.test', '{"full_name":"Display Outsider"}'::jsonb);

create temporary table display_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  session_id uuid,
  token_hash text not null,
  realtime_topic text not null,
  old_token_hash text
);

grant select, insert, update on display_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

insert into display_test_context (organization_id, store_id, register_id, token_hash, realtime_topic)
select organization_id, store_id, register_id, repeat('a', 64), repeat('A', 43)
from public.bootstrap_organization('Display Test Retail', 'Display Main', 'Display Counter');

update display_test_context context
set session_id = (
  select session_id
  from public.provision_customer_display_session(
    context.organization_id,
    context.register_id,
    context.token_hash,
    context.realtime_topic
  )
);

select ok((select session_id is not null from display_test_context), 'register manager provisions an opaque display session');
select is(
  (select count(*) from public.get_customer_display_management_sessions((select organization_id from display_test_context))),
  1::bigint,
  'manager sees one active display session'
);
select is(
  (select count(*) from public.get_pos_customer_display_sessions_with_ids((select organization_id from display_test_context))),
  1::bigint,
  'assigned POS user receives its session identifier and topic'
);

create or replace function pg_temp.display_state_without_shift_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.set_customer_display_state(
    (select organization_id from display_test_context),
    (select session_id from display_test_context),
    jsonb_build_object('status', 'cart', 'items', jsonb_build_array())
  );
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;

select ok(pg_temp.display_state_without_shift_is_rejected(), 'display state cannot be updated without an open shift');
select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, null)$$,
    (select organization_id from display_test_context),
    (select store_id from display_test_context),
    (select register_id from display_test_context)
  ),
  'owner opens the paired register shift'
);
select lives_ok(
  format(
    $$select public.set_customer_display_state(%L, %L, %L::jsonb)$$,
    (select organization_id from display_test_context),
    (select session_id from display_test_context),
    jsonb_build_object('status', 'cart', 'items', jsonb_build_array(jsonb_build_object('name', 'Display item')))
  ),
  'open-shift owner can persist a sanitized display snapshot'
);
select is(
  public.get_customer_display_bootstrap((select token_hash from display_test_context))->'current_state'->>'status',
  'cart',
  'bootstrap returns the persisted presentation state'
);

create or replace function pg_temp.outsider_display_access_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_pos_customer_display_sessions_with_ids((select organization_id from display_test_context));
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;

set local request.jwt.claim.sub = 'b2222222-2222-4222-8222-222222222222';
select ok(pg_temp.outsider_display_access_is_rejected(), 'unassigned user cannot obtain an organization display topic');

set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';
update display_test_context
set old_token_hash = token_hash,
    token_hash = repeat('b', 64),
    realtime_topic = repeat('B', 43);
update display_test_context context
set session_id = (
  select session_id
  from public.provision_customer_display_session(
    context.organization_id,
    context.register_id,
    context.token_hash,
    context.realtime_topic
  )
);

select is(
  (select count(*) from public.get_customer_display_management_sessions((select organization_id from display_test_context))),
  1::bigint,
  'rotating a link leaves exactly one active session'
);

create or replace function pg_temp.old_display_token_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_customer_display_bootstrap((select old_token_hash from display_test_context));
  return false;
exception when no_data_found then
  return true;
end;
$$;

select ok(pg_temp.old_display_token_is_rejected(), 'rotating a link invalidates its previous customer display capability');
select is(
  public.get_customer_display_bootstrap((select token_hash from display_test_context))->>'register_name',
  'Display Counter',
  'replacement capability bootstraps the same register display'
);

select * from finish();
rollback;
