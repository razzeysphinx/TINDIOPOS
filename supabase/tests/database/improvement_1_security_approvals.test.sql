begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select has_table('public', 'approval_rules', 'approval rules table exists');
select has_table('public', 'approval_requests', 'approval requests table exists');
select has_table('public', 'audit_logs', 'audit log table exists');
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('approval_rules', 'approval_requests', 'audit_logs')
      and relation.relrowsecurity
  ),
  3::bigint,
  'RLS is enabled on every Improvement 1 public table'
);

select ok(to_regprocedure('public.set_employee_pin(uuid,uuid,text)') is not null, 'secure employee PIN routine exists');
select ok(to_regprocedure('public.request_manager_approval(uuid,text,text,jsonb)') is not null, 'approval request routine exists');
select ok(to_regprocedure('public.approve_manager_approval(uuid,uuid,text,text)') is not null, 'manager approval routine exists');
select ok(to_regprocedure('public.update_approval_rule(uuid,text,text,bigint,boolean)') is not null, 'approval rule update routine exists');
select ok(to_regprocedure('public.refund_sale(uuid,uuid,uuid,uuid,text,text,jsonb,uuid)') is not null, 'approval-aware refund routine exists');
select ok(to_regprocedure('public.record_cash_movement(uuid,uuid,text,bigint,text,uuid,uuid)') is not null, 'approval-aware cash movement routine exists');
select ok(to_regprocedure('public.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text,uuid)') is not null, 'approval-aware inventory routine exists');

select ok(not has_table_privilege('authenticated', 'public.approval_rules', 'insert'), 'users cannot insert rules directly');
select ok(not has_table_privilege('authenticated', 'public.approval_requests', 'insert'), 'users cannot insert requests directly');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'insert'), 'users cannot insert audit logs directly');
select ok(not has_table_privilege('authenticated', 'private.employee_pin_credentials', 'select'), 'PIN hashes are not readable by authenticated users');
select ok(not has_function_privilege('anon', 'public.request_manager_approval(uuid,text,text,jsonb)', 'execute'), 'anonymous callers cannot request manager approval');
select ok(has_function_privilege('authenticated', 'public.request_manager_approval(uuid,text,text,jsonb)', 'execute'), 'authenticated employees can request manager approval');

insert into auth.users (id, email, raw_user_meta_data)
values (
  '81818181-8181-4818-8818-818181818181',
  'security-owner@tindio.test',
  '{"full_name":"Security Owner"}'::jsonb
);

create temporary table security_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null
);
grant select, insert on table security_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '81818181-8181-4818-8818-818181818181';

insert into security_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Security Test Retail', 'Security Test Main', 'Security Test Counter');

select is(
  (select count(*) from public.approval_rules),
  9::bigint,
  'new organizations receive all default approval rules'
);
select ok(
  exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
    where role.code = 'manager'
      and permission.permission_code = 'approvals.authorize'
  ),
  'new manager role receives approval authority'
);

select * from finish();
rollback;
