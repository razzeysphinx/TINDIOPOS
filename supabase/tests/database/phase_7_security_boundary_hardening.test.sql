begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('7a700000-0000-4000-8000-000000000001', 'phase-seven-owner@tindio.test', '{"full_name":"Phase Seven Owner"}'::jsonb),
  ('7a700000-0000-4000-8000-000000000002', 'phase-seven-cashier@tindio.test', '{"full_name":"Phase Seven Cashier"}'::jsonb);

create temporary table phase_7_security_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  tax_rate_id uuid
);

grant select, insert, update on table phase_7_security_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '7a700000-0000-4000-8000-000000000001';

insert into phase_7_security_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Phase Seven Retail', 'Phase Seven Main', 'Phase Seven Counter');

with inserted_tax_rate as (
  insert into public.tax_rates (organization_id, name, rate_bps, is_inclusive, is_default)
  select organization_id, 'Phase Seven Tax', 725, false, true
  from phase_7_security_context
  returning id
)
update phase_7_security_context
set tax_rate_id = (select id from inserted_tax_rate);

reset role;

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '7a700000-0000-4000-8000-000000000002', 'PHASE7-CASHIER', 'Cashier'
from phase_7_security_context;

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = '7a700000-0000-4000-8000-000000000002';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join phase_7_security_context context
  on context.organization_id = employee.organization_id
where employee.profile_id = '7a700000-0000-4000-8000-000000000002';

create or replace function pg_temp.cashier_tax_rate_change_is_rejected()
returns boolean
language plpgsql
as $$
declare
  changed_rows integer;
begin
  update public.tax_rates
  set rate_bps = 9999
  where id = (select tax_rate_id from phase_7_security_context);

  get diagnostics changed_rows = row_count;
  return changed_rows = 0;
end;
$$;

create or replace function pg_temp.cashier_role_change_is_rejected()
returns boolean
language plpgsql
as $$
declare
  changed_rows integer;
begin
  update public.roles
  set name = 'Unauthorized Role Name'
  where organization_id = (select organization_id from phase_7_security_context)
    and code = 'cashier';

  get diagnostics changed_rows = row_count;
  return changed_rows = 0;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '7a700000-0000-4000-8000-000000000002';

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.tax_rates'::regclass),
  'tax settings keep RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.tax_rates', 'update'),
  'anonymous callers cannot update tax settings'
);

select ok(
  not exists (
    select 1
    from public.employee_roles employee_role
    join public.role_permissions permission
      on permission.organization_id = employee_role.organization_id
     and permission.role_id = employee_role.role_id
    join public.employees employee
      on employee.id = employee_role.employee_id
     and employee.organization_id = employee_role.organization_id
    where employee.profile_id = (select auth.uid())
      and permission.permission_code = 'products.manage'
  ),
  'cashier does not receive product-management authority'
);

select ok(
  pg_temp.cashier_tax_rate_change_is_rejected(),
  'cashier tax-rate changes are rejected by RLS'
);

select is(
  (select rate_bps from public.tax_rates where id = (select tax_rate_id from phase_7_security_context)),
  725,
  'the tax rate remains unchanged after the unauthorized attempt'
);

select ok(
  pg_temp.cashier_role_change_is_rejected(),
  'cashier administrative role changes are rejected by RLS'
);

select is(
  (select name from public.roles where organization_id = (select organization_id from phase_7_security_context) and code = 'cashier'),
  'Cashier',
  'the system cashier role remains unchanged after the unauthorized attempt'
);

select * from finish();
rollback;
