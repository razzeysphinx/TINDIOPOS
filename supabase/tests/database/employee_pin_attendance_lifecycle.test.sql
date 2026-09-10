begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_column('public', 'employees', 'archived_at', 'employee archive timestamp exists');
select has_column('public', 'time_clock_entries', 'clock_in_verification_method', 'attendance records verification method');
select ok(to_regprocedure('public.clock_in_employee_with_pin(uuid,uuid,uuid,text,uuid)') is not null, 'PIN clock-in RPC exists');
select ok(to_regprocedure('public.change_employee_lifecycle(uuid,uuid,text,text)') is not null, 'controlled lifecycle RPC exists');
select ok(not has_function_privilege('authenticated', 'public.clock_in_employee(uuid,uuid,text)', 'execute'), 'legacy no-PIN clock-in is revoked');
select ok(not has_table_privilege('authenticated', 'private.employee_pin_credentials', 'select'), 'PIN hashes remain private');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', 'attendance-owner@tindio.test', '{"full_name":"Attendance Owner"}'::jsonb),
  ('e1000000-0000-4000-8000-000000000002', 'attendance-worker@tindio.test', '{"full_name":"Attendance Worker"}'::jsonb),
  ('e1000000-0000-4000-8000-000000000003', 'unused-worker@tindio.test', '{"full_name":"Unused Worker"}'::jsonb);
create temporary table attendance_context (organization_id uuid, store_id uuid, register_id uuid, worker_id uuid, unused_id uuid);
grant select, insert, update on attendance_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';
insert into attendance_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id from public.bootstrap_organization('Attendance Lifecycle Test', 'Main', 'R1');
reset role;
insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'e1000000-0000-4000-8000-000000000002'::uuid, 'ATT-WORKER', 'Cashier' from attendance_context
union all select organization_id, 'e1000000-0000-4000-8000-000000000003'::uuid, 'ATT-UNUSED', 'Cashier' from attendance_context;
update attendance_context context set
 worker_id = (select id from public.employees where organization_id = context.organization_id and profile_id = 'e1000000-0000-4000-8000-000000000002'),
 unused_id = (select id from public.employees where organization_id = context.organization_id and profile_id = 'e1000000-0000-4000-8000-000000000003');
insert into public.employee_roles (organization_id, employee_id, role_id)
select context.organization_id, employee.id, role.id from attendance_context context
join public.employees employee on employee.id in (context.worker_id, context.unused_id)
join public.roles role on role.organization_id = context.organization_id and role.code = 'cashier';
insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.store_id from attendance_context context
join public.employees employee on employee.id in (context.worker_id, context.unused_id);

set local role authenticated;
set local request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000001';
select public.set_employee_pin((select organization_id from attendance_context), (select worker_id from attendance_context), '123456');
select is((select result_code from public.clock_in_employee_with_pin((select organization_id from attendance_context), (select store_id from attendance_context), (select worker_id from attendance_context), '999999', 'e1000000-0000-4000-8000-000000000011')), 'INVALID_PIN', 'wrong PIN is rejected');
select is((select result_code from public.clock_in_employee_with_pin((select organization_id from attendance_context), (select store_id from attendance_context), (select worker_id from attendance_context), '123456', 'e1000000-0000-4000-8000-000000000012')), 'CLOCKED_IN', 'correct PIN clocks in');
select is((select count(*) from public.shifts where organization_id = (select organization_id from attendance_context) and status = 'open'), 0::bigint, 'clock-in does not open a shift');
select is((select result_code from public.clock_in_employee_with_pin((select organization_id from attendance_context), (select store_id from attendance_context), (select worker_id from attendance_context), '123456', 'e1000000-0000-4000-8000-000000000013')), 'CLOCKED_IN', 'double clock-in is idempotent');
select is((select count(*) from public.time_clock_entries where employee_id = (select worker_id from attendance_context) and clocked_out_at is null), 1::bigint, 'double clock-in creates no duplicate');
select is((select result_code from public.clock_out_employee_with_pin((select organization_id from attendance_context), (select worker_id from attendance_context), '999999', 'e1000000-0000-4000-8000-000000000014')), 'INVALID_PIN', 'wrong PIN cannot clock out');
select is((select result_code from public.clock_out_employee_with_pin((select organization_id from attendance_context), (select worker_id from attendance_context), '123456', 'e1000000-0000-4000-8000-000000000015')), 'CLOCKED_OUT', 'valid clock-out closes attendance');
select is(public.change_employee_lifecycle((select organization_id from attendance_context), (select worker_id from attendance_context), 'DEACTIVATE', 'Season ended'), 'inactive', 'employee can be deactivated');
select is((select result_code from public.clock_in_employee_with_pin((select organization_id from attendance_context), (select store_id from attendance_context), (select worker_id from attendance_context), '123456', 'e1000000-0000-4000-8000-000000000017')), 'EMPLOYEE_INACTIVE', 'a deactivated employee cannot use attendance');
select is(public.change_employee_lifecycle((select organization_id from attendance_context), (select worker_id from attendance_context), 'REACTIVATE', 'Returning employee'), 'active', 'employee can be reactivated');
select is((select result_code from public.clock_in_employee_with_pin((select organization_id from attendance_context), (select store_id from attendance_context), (select worker_id from attendance_context), '123456', 'e1000000-0000-4000-8000-000000000016')), 'PIN_NOT_SET', 'reactivation does not restore old PIN');
select is(public.change_employee_lifecycle((select organization_id from attendance_context), (select unused_id from attendance_context), 'DEACTIVATE', 'Invite unused'), 'inactive', 'unused employee deactivates');
select is(public.change_employee_lifecycle((select organization_id from attendance_context), (select unused_id from attendance_context), 'ARCHIVE', 'Invite unused'), 'archived', 'unused employee archives');
select lives_ok(format($$select public.delete_employee_if_eligible(%L, %L, 'ATT-UNUSED')$$, (select organization_id from attendance_context), (select unused_id from attendance_context)), 'zero-history archived employee can be deleted');
select ok(not exists(select 1 from public.employees where id = (select unused_id from attendance_context)), 'eligible employee row was deleted');

select * from finish();
rollback;
