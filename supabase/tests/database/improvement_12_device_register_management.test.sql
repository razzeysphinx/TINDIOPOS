begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select has_table('public', 'pos_devices', 'POS device registry table exists');
select has_table('private', 'pos_device_credentials', 'device credential hashes are kept in the private schema');
select has_column('public', 'organizations', 'device_management_enabled', 'organizations record device enforcement state');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.pos_devices'::regclass), 'POS device registry uses RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'private.pos_device_credentials'::regclass), 'device credential hashes use RLS');
select ok(to_regprocedure('public.register_pos_device(uuid,uuid,uuid,uuid,text,text,text)') is not null, 'secure device registration function exists');
select ok(to_regprocedure('public.change_pos_device_register(uuid,uuid,uuid,uuid)') is not null, 'secure register-binding change function exists');
select ok(to_regprocedure('public.revoke_pos_device(uuid,uuid,text)') is not null, 'secure device revocation function exists');
select ok(to_regprocedure('public.validate_pos_device(uuid,uuid,text,text)') is not null, 'POS device validation function exists');
select ok(not has_table_privilege('authenticated', 'public.pos_devices', 'insert'), 'authenticated callers cannot directly register devices');
select ok(not has_table_privilege('authenticated', 'public.pos_devices', 'update'), 'authenticated callers cannot directly change device bindings');
select ok(not has_table_privilege('authenticated', 'private.pos_device_credentials', 'select'), 'authenticated callers cannot read device credential hashes');
select ok(not has_function_privilege('anon', 'public.register_pos_device(uuid,uuid,uuid,uuid,text,text,text)', 'execute'), 'anonymous callers cannot register devices');
select ok(not has_function_privilege('anon', 'public.revoke_pos_device(uuid,uuid,text)', 'execute'), 'anonymous callers cannot revoke devices');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('c1111111-1111-4111-8111-111111111111', 'device-owner@tindio.test', '{"full_name":"Device Owner"}'::jsonb),
  ('c2222222-2222-4222-8222-222222222222', 'device-outsider@tindio.test', '{"full_name":"Device Outsider"}'::jsonb);

create temporary table device_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  second_register_id uuid
);
grant select, insert on device_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'c1111111-1111-4111-8111-111111111111';

with bootstrap as (
  select *
  from public.bootstrap_organization('Device Test Retail', 'Device Main', 'Device Counter')
)
insert into device_test_context (organization_id, store_id, register_id, second_register_id)
select bootstrap.organization_id, bootstrap.store_id, bootstrap.register_id, null
from bootstrap;

set local role postgres;
with second_register as (
  insert into public.registers (organization_id, store_id, name, code)
  select organization_id, store_id, 'Device Counter Two', 'DEVICE-02'
  from device_test_context
  returning id
)
update device_test_context context
set second_register_id = second_register.id
from second_register;
set local role authenticated;

select ok(
  (select private.has_permission(organization_id, 'devices.manage') from device_test_context),
  'organization owner receives device-management permission'
);
select ok(
  not exists (
    select 1
    from public.roles role
    where role.code in ('owner', 'admin')
      and not exists (
        select 1 from public.role_permissions permission
        where permission.role_id = role.id and permission.permission_code = 'devices.manage'
      )
  ),
  'every existing Owner and Admin role receives device-management permission'
);

select lives_ok(
  format(
    $$select public.register_pos_device(%L, %L, %L, 'd1111111-1111-4111-8111-111111111111', 'Primary POS browser', 'web-test', repeat('a', 64))$$,
    (select organization_id from device_test_context),
    (select store_id from device_test_context),
    (select register_id from device_test_context)
  ),
  'owner can register a secure POS device'
);
select ok(
  (select device_management_enabled from public.organizations where id = (select organization_id from device_test_context)),
  'first device registration enables device enforcement'
);
select is(
  (select status from public.pos_devices where id = 'd1111111-1111-4111-8111-111111111111'),
  'active',
  'new POS device is active'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where organization_id = (select organization_id from device_test_context)
      and event_type = 'DEVICE_REGISTERED'
  ),
  'device registration is audited'
);

set local request.headers = '{"x-tindio-device-id":"d1111111-1111-4111-8111-111111111111","x-tindio-device-secret":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","x-tindio-app-version":"web-test"}';
select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, null)$$,
    (select organization_id from device_test_context),
    (select store_id from device_test_context),
    (select register_id from device_test_context)
  ),
  'a correctly enrolled device can open its assigned register shift'
);

create or replace function pg_temp.open_shift_without_device_is_rejected()
returns boolean language plpgsql as $$
begin
  perform set_config('request.headers', '{}', true);
  perform public.open_register_shift(
    (select organization_id from device_test_context),
    (select store_id from device_test_context),
    (select register_id from device_test_context),
    0,
    null
  );
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
select ok(pg_temp.open_shift_without_device_is_rejected(), 'a device-managed register rejects a shift without its credential');

set local request.headers = '{"x-tindio-device-id":"d1111111-1111-4111-8111-111111111111","x-tindio-device-secret":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","x-tindio-app-version":"web-test"}';
select lives_ok(
  format(
    $$select public.change_pos_device_register(%L, 'd1111111-1111-4111-8111-111111111111', %L, %L)$$,
    (select organization_id from device_test_context),
    (select store_id from device_test_context),
    (select second_register_id from device_test_context)
  ),
  'owner can change an active device register binding'
);
select is(
  (select register_id from public.pos_devices where id = 'd1111111-1111-4111-8111-111111111111'),
  (select second_register_id from device_test_context),
  'device binding persists the selected register'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where organization_id = (select organization_id from device_test_context)
      and event_type = 'DEVICE_REGISTER_CHANGED'
  ),
  'device register change is audited'
);

select lives_ok(
  format(
    $$select public.revoke_pos_device(%L, 'd1111111-1111-4111-8111-111111111111', 'Test revocation')$$,
    (select organization_id from device_test_context)
  ),
  'owner can revoke an active device'
);
select is(
  (select status from public.pos_devices where id = 'd1111111-1111-4111-8111-111111111111'),
  'revoked',
  'revoked device cannot remain active'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where organization_id = (select organization_id from device_test_context)
      and event_type = 'DEVICE_REVOKED'
  ),
  'device revocation is audited'
);

create or replace function pg_temp.revoked_device_is_rejected()
returns boolean language plpgsql as $$
begin
  perform public.validate_pos_device(
    (select organization_id from device_test_context),
    'd1111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'web-test'
  );
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
select ok(pg_temp.revoked_device_is_rejected(), 'a revoked device credential is rejected');

set local request.jwt.claim.sub = 'c2222222-2222-4222-8222-222222222222';
select is(
  (select count(*) from public.pos_devices where organization_id = (select organization_id from device_test_context)),
  0::bigint,
  'an unrelated user cannot read another organization’s devices'
);

select * from finish();
rollback;
