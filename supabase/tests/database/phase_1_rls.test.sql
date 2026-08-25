begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'owner-a@tindio.test',
    '{"full_name":"Owner Alpha"}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'owner-b@tindio.test',
    '{"full_name":"Owner Beta"}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'admin@tindio.test',
    '{"full_name":"Invited Admin"}'::jsonb
  );

create temporary table test_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null
);

grant select, insert on table test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

insert into test_context (label, organization_id, store_id, register_id)
select 'alpha', organization_id, store_id, register_id
from public.bootstrap_organization('Alpha Retail', 'Alpha Main', 'Alpha Counter');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

insert into test_context (label, organization_id, store_id, register_id)
select 'beta', organization_id, store_id, register_id
from public.bootstrap_organization('Beta Retail', 'Beta Main', 'Beta Counter');

reset role;

create or replace function pg_temp.cross_store_insert_is_rejected()
returns boolean
language plpgsql
as $$
begin
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Unauthorized Store', 'BLOCKED'
  from test_context
  where label = 'beta';

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.second_bootstrap_is_allowed()
returns boolean
language plpgsql
as $$
begin
  perform *
  from public.bootstrap_organization('Duplicate', 'Duplicate', 'Duplicate');

  return true;
end;
$$;

create or replace function pg_temp.owner_role_assignment_is_rejected()
returns boolean
language plpgsql
as $$
begin
  insert into public.employee_roles (organization_id, employee_id, role_id)
  select employee.organization_id, employee.id, role.id
  from public.employees employee
  join public.roles role
    on role.organization_id = employee.organization_id
   and role.code = 'owner'
  where employee.profile_id = (select auth.uid());

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

create or replace function pg_temp.escalated_role_creation_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.create_custom_role(
    (select organization_id from public.employees where profile_id = (select auth.uid())),
    'Escalated Role',
    'escalated_role',
    'Must not be created.',
    array['organization.manage']
  );

  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select is((select count(*) from public.profiles), 1::bigint, 'owner sees only their profile');
select is((select count(*) from public.organizations), 1::bigint, 'owner sees only their organization');
select is((select count(*) from public.stores), 1::bigint, 'owner sees only their store');
select is((select count(*) from public.registers), 1::bigint, 'owner sees only their register');
select is((select count(*) from public.employees), 1::bigint, 'owner sees only their organization employees');
select is((select count(*) from public.roles), 5::bigint, 'starter roles are created');
select is(
  (
    select count(distinct role_permission.permission_code)
    from public.employee_roles employee_role
    join public.role_permissions role_permission
      on role_permission.organization_id = employee_role.organization_id
     and role_permission.role_id = employee_role.role_id
  ),
  (select count(*) from public.permissions),
  'owner receives the full permission catalogue'
);
select is(
  (
    select count(*)
    from public.organizations
    where id = (
      select organization_id from test_context where label = 'beta'
    )
  ),
  0::bigint,
  'cross-organization reads return no rows'
);
select ok(pg_temp.cross_store_insert_is_rejected(), 'cross-organization inserts are rejected');
select ok(pg_temp.second_bootstrap_is_allowed(), 'a user can bootstrap a second tenant-isolated organization');
select lives_ok(
  $$update public.organizations set name = 'Alpha Retail Updated' where name = 'Alpha Retail'$$,
  'owner can update their own organization'
);

insert into public.employee_invitations (
  organization_id,
  email,
  employee_number,
  job_title,
  role_id,
  store_id,
  token_hash,
  invited_by
)
select
  employee.organization_id,
  'admin@tindio.test',
  'ADMIN-001',
  'Administrator',
  role.id,
  (select store_id from test_context where label = 'alpha'),
  repeat('a', 64),
  employee.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'admin'
where employee.profile_id = (select auth.uid())
  and employee.organization_id = (select organization_id from test_context where label = 'alpha');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","email":"admin@tindio.test"}';

select is(
  (select count(*) from public.employee_invitations),
  1::bigint,
  'only the matching email can see the invitation'
);
select lives_ok(
  $$select public.accept_employee_invitation(repeat('a', 64))$$,
  'matching authenticated email can accept the invitation'
);
select is(
  (select count(*) from public.employees),
  2::bigint,
  'accepted admin can see organization employees'
);
select is(
  (
    select count(*)
    from public.employee_roles employee_role
    join public.employees employee on employee.id = employee_role.employee_id
    join public.roles role on role.id = employee_role.role_id
    where employee.profile_id = (select auth.uid())
      and role.code = 'admin'
  ),
  1::bigint,
  'acceptance assigns exactly the invited role'
);
select is(
  (
    select count(*)
    from public.employee_stores employee_store
    join public.employees employee on employee.id = employee_store.employee_id
    where employee.profile_id = (select auth.uid())
  ),
  1::bigint,
  'acceptance assigns exactly one store'
);
select ok(
  pg_temp.owner_role_assignment_is_rejected(),
  'an admin cannot assign a role containing permissions they do not hold'
);
select ok(
  pg_temp.escalated_role_creation_is_rejected(),
  'an admin cannot create a role containing organization ownership'
);

select * from finish();
rollback;
