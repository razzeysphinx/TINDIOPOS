begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select has_table('public', 'organization_features', 'organization feature settings table exists');
select has_column('public', 'organizations', 'business_type', 'organizations retain the chosen business type');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.organization_features'::regclass),
  'organization feature settings use RLS'
);
select ok(
  to_regprocedure('public.update_business_profile_features(uuid,text,jsonb)') is not null,
  'business profile update routine exists'
);
select ok(
  to_regprocedure('public.bootstrap_organization_v2(text,text,text,text,text,text)') is not null,
  'business-aware organization bootstrap routine exists'
);
select ok(
  not has_function_privilege('anon', 'public.update_business_profile_features(uuid,text,jsonb)', 'execute'),
  'anonymous callers cannot update a business profile'
);
select ok(
  has_function_privilege('authenticated', 'public.update_business_profile_features(uuid,text,jsonb)', 'execute'),
  'authenticated callers can reach the protected business profile routine'
);
select ok(
  not has_table_privilege('authenticated', 'public.organization_features', 'update'),
  'authenticated callers cannot directly modify feature settings'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('b1111111-1111-4111-8111-111111111111', 'business-profile-owner@tindio.test', '{"full_name":"Business Profile Owner"}'::jsonb),
  ('b2222222-2222-4222-8222-222222222222', 'business-profile-outsider@tindio.test', '{"full_name":"Business Profile Outsider"}'::jsonb),
  ('b3333333-3333-4333-8333-333333333333', 'legacy-bootstrap-owner@tindio.test', '{"full_name":"Legacy Bootstrap Owner"}'::jsonb);

create temporary table business_profile_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null
);
grant select, insert on business_profile_test_context to authenticated;

create temporary table business_profile_legacy_context (
  organization_id uuid not null
);
grant select, insert on business_profile_legacy_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'b1111111-1111-4111-8111-111111111111';

insert into business_profile_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization_v2(
  'Restaurant Profile Test',
  'Restaurant Main',
  'Restaurant Counter',
  'PHP',
  'Asia/Manila',
  'restaurant_cafe'
);

select is(
  (select business_type from public.organizations where id = (select organization_id from business_profile_test_context)),
  'restaurant_cafe',
  'restaurant bootstrap stores the selected business type'
);
select is(
  (select count(*) from public.organization_features where organization_id = (select organization_id from business_profile_test_context)),
  14::bigint,
  'restaurant bootstrap initializes every feature setting'
);
select ok(
  (select is_enabled from public.organization_features where organization_id = (select organization_id from business_profile_test_context) and feature_key = 'open_tickets'),
  'restaurant recommendation enables open tickets'
);
select ok(
  (select is_enabled from public.organization_features where organization_id = (select organization_id from business_profile_test_context) and feature_key = 'dining'),
  'restaurant recommendation enables dining'
);
select ok(
  (select is_enabled from public.organization_features where organization_id = (select organization_id from business_profile_test_context) and feature_key = 'modifiers'),
  'restaurant recommendation enables modifiers'
);
select ok(
  (select is_enabled from public.organization_features where organization_id = (select organization_id from business_profile_test_context) and feature_key = 'kitchen_display'),
  'restaurant recommendation enables kitchen display'
);
select ok(
  not (select is_enabled from public.organization_features where organization_id = (select organization_id from business_profile_test_context) and feature_key = 'multi_store'),
  'restaurant recommendation does not enable multi-store by default'
);

select lives_ok(
  format(
    $$select public.update_business_profile_features(%L, 'service', %L::jsonb)$$,
    (select organization_id from business_profile_test_context),
    jsonb_build_object(
      'inventory', false, 'shifts', true, 'time_clock', true,
      'open_tickets', false, 'dining', false, 'modifiers', false,
      'loyalty', true, 'customer_display', false, 'kitchen_display', false,
      'purchase_orders', false, 'transfers', false, 'production', false,
      'weighted_products', false, 'multi_store', false
    )
  ),
  'an organization owner can tailor feature settings'
);
select is(
  (select business_type from public.organizations where id = (select organization_id from business_profile_test_context)),
  'service',
  'business profile updates the business type'
);
select ok(
  not (select is_enabled from public.organization_features where organization_id = (select organization_id from business_profile_test_context) and feature_key = 'inventory'),
  'business profile persists disabled feature settings'
);
select is(
  (select count(*) from public.organization_features where organization_id = (select organization_id from business_profile_test_context)),
  14::bigint,
  'disabling features preserves every historical feature setting row'
);
select ok(
  exists (
    select 1
    from public.audit_logs
    where organization_id = (select organization_id from business_profile_test_context)
      and event_type = 'BUSINESS_PROFILE_UPDATED'
      and operation_code = 'settings.manage'
  ),
  'business profile changes are audited'
);

create or replace function pg_temp.business_profile_update_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.update_business_profile_features(
    (select organization_id from business_profile_test_context),
    'retail',
    '{"inventory": true}'::jsonb
  );
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;

set local request.jwt.claim.sub = 'b2222222-2222-4222-8222-222222222222';
select ok(pg_temp.business_profile_update_is_rejected(), 'an unrelated user cannot update business features');

set local request.jwt.claim.sub = 'b3333333-3333-4333-8333-333333333333';
insert into business_profile_legacy_context (organization_id)
select organization_id
from public.bootstrap_organization('Legacy Profile Test', 'Legacy Main', 'Legacy Counter');

select is(
  (
    select count(*)
    from public.organization_features
    where organization_id = (select organization_id from business_profile_legacy_context)
  ),
  14::bigint,
  'the original bootstrap routine also initializes feature settings'
);
select ok(
  not exists (
    select 1
    from public.organization_features feature
    join public.organizations organization on organization.id = feature.organization_id
    where organization.name = 'Legacy Profile Test'
      and feature.feature_key = 'kitchen_display'
      and feature.is_enabled
  ),
  'legacy bootstrap receives retail recommendations without breaking existing callers'
);

select * from finish();
rollback;
