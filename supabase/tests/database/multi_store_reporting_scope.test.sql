begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('d1010101-0101-4101-8101-010101010101', 'scope-owner@tindio.test', '{"full_name":"Scope Owner"}'::jsonb),
  ('d2020202-0202-4202-8202-020202020202', 'scope-manager@tindio.test', '{"full_name":"Scope Manager"}'::jsonb);

create temporary table scope_context (
  organization_id uuid not null,
  assigned_store_id uuid not null,
  unassigned_store_id uuid,
  register_id uuid not null,
  manager_employee_id uuid
);
grant select, insert, update on scope_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'd1010101-0101-4101-8101-010101010101';

insert into scope_context (organization_id, assigned_store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Scope Test Retail', 'Scope Main', 'Scope Counter');

insert into public.stores (organization_id, name, code)
select organization_id, store_name, store_code
from scope_context
cross join (values
  ('Scope Branch 2', 'SCOPE-02'),
  ('Scope Branch 3', 'SCOPE-03'),
  ('Scope Branch 4', 'SCOPE-04'),
  ('Scope Branch 5', 'SCOPE-05')
) as branch(store_name, store_code);

update scope_context context
set unassigned_store_id = store.id
from public.stores store
where store.organization_id = context.organization_id
  and store.code = 'SCOPE-02';

insert into public.roles (organization_id, name, code, is_system)
select organization_id, 'Scoped report manager', 'scoped_report_manager', false
from scope_context;

insert into public.role_permissions (organization_id, role_id, permission_code)
select context.organization_id, role.id, permission.permission_code
from scope_context context
join public.roles role
  on role.organization_id = context.organization_id
 and role.code = 'scoped_report_manager'
cross join (values ('reports.view'), ('receipts.view'), ('inventory.manage'), ('devices.manage'), ('audit.view'), ('shifts.view_history')) as permission(permission_code);

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'd2020202-0202-4202-8202-020202020202', 'SCOPE-MANAGER', 'Store manager'
from scope_context;

update scope_context context
set manager_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = 'd2020202-0202-4202-8202-020202020202';

insert into public.employee_roles (organization_id, employee_id, role_id)
select context.organization_id, context.manager_employee_id, role.id
from scope_context context
join public.roles role
  on role.organization_id = context.organization_id
 and role.code = 'scoped_report_manager';

insert into public.employee_stores (organization_id, employee_id, store_id)
select organization_id, manager_employee_id, assigned_store_id
from scope_context;

select is((select count(*) from public.stores where organization_id = (select organization_id from scope_context)), 5::bigint, 'fixture has five stores');

set local request.jwt.claim.sub = 'd2020202-0202-4202-8202-020202020202';

select is((select count(*) from public.stores where organization_id = (select organization_id from scope_context)), 1::bigint, 'store manager selector can read only its assigned store');
select is((select count(*) from public.registers where organization_id = (select organization_id from scope_context)), 1::bigint, 'store manager can read only registers in its assigned store');
select ok(private.has_store_read_scope((select organization_id from scope_context), (select assigned_store_id from scope_context)), 'assigned store passes the shared backend scope check');
select ok(not private.has_store_read_scope((select organization_id from scope_context), (select unassigned_store_id from scope_context)), 'unassigned store fails the shared backend scope check');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'receipts' and policyname = 'receipts_select_receipts_authorized' and qual like '%has_sale_read_scope%'), 'receipt history policy uses sale store scope');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_levels' and policyname = 'inventory_levels_select_authorized_scope' and qual like '%has_store_read_scope%'), 'inventory projection policy uses store scope');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'offline_sync_events' and policyname = 'offline_sync_events_select_device_managers' and qual like '%has_store_read_scope%'), 'offline sync policy uses store scope');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_select_authorized' and qual like '%has_store_read_scope%'), 'audit policy uses store scope');

create or replace function pg_temp.unassigned_report_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_reports_snapshot((select organization_id from scope_context), current_date, current_date, (select unassigned_store_id from scope_context));
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
select ok(pg_temp.unassigned_report_is_rejected(), 'cross-store reporting RPC access is rejected');

create or replace function pg_temp.unscoped_report_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_reports_snapshot((select organization_id from scope_context), current_date, current_date, null);
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
select ok(pg_temp.unscoped_report_is_rejected(), 'raw organization-wide reporting RPC access is rejected for a scoped manager');

select ok(has_function_privilege('authenticated', 'public.get_shift_audit_report(uuid,uuid)', 'execute'), 'authorized callers use the scoped shift-audit wrapper');
select ok(not has_function_privilege('authenticated', 'public.get_shift_audit_report_internal(uuid,uuid)', 'execute'), 'the unscoped shift-audit implementation cannot be called directly');

select * from finish();
rollback;
