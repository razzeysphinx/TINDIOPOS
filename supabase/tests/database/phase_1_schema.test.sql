begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'stores', 'stores table exists');
select has_table('public', 'registers', 'registers table exists');
select has_table('public', 'employees', 'employees table exists');
select has_table('public', 'employee_stores', 'employee_stores table exists');
select has_table('public', 'roles', 'roles table exists');
select has_table('public', 'permissions', 'permissions table exists');
select has_table('public', 'role_permissions', 'role_permissions table exists');
select has_table('public', 'employee_roles', 'employee_roles table exists');
select has_table(
  'public',
  'employee_invitations',
  'employee_invitations table exists'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'profiles', 'organizations', 'stores', 'registers', 'employees',
        'employee_stores', 'roles', 'permissions', 'role_permissions',
        'employee_roles', 'employee_invitations'
      )
      and relation.relrowsecurity
  ),
  11::bigint,
  'RLS is enabled on every Phase 1 application table'
);

select * from finish();
rollback;
