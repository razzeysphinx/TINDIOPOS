begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('8b800000-0000-4000-8000-000000000001', 'owner-store-access-owner@tindio.test', '{"full_name":"Owner Store Access"}'::jsonb),
  ('8b800000-0000-4000-8000-000000000002', 'owner-store-access-custom@tindio.test', '{"full_name":"Custom Organization Manager"}'::jsonb),
  ('8b800000-0000-4000-8000-000000000003', 'owner-store-access-scoped@tindio.test', '{"full_name":"Scoped Store Manager"}'::jsonb);

create temporary table owner_store_access_context (
  organization_id uuid not null,
  primary_store_id uuid not null,
  secondary_store_id uuid,
  tertiary_store_id uuid,
  owner_employee_id uuid not null,
  owner_role_id uuid not null,
  custom_employee_id uuid,
  scoped_employee_id uuid,
  custom_role_id uuid not null,
  scoped_role_id uuid not null
);

grant select, insert, update on table owner_store_access_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '8b800000-0000-4000-8000-000000000001';

insert into owner_store_access_context (
  organization_id,
  primary_store_id,
  owner_employee_id,
  owner_role_id,
  custom_role_id,
  scoped_role_id
)
select
  setup.organization_id,
  setup.store_id,
  '8b800000-0000-4000-8000-000000000001'::uuid,
  '8b800000-0000-4000-8000-000000000012'::uuid,
  '8b800000-0000-4000-8000-000000000010'::uuid,
  '8b800000-0000-4000-8000-000000000011'::uuid
from public.bootstrap_organization('Owner Store Access', 'Owner Store Access Main', 'Owner Store Access Register') setup;

reset role;

update owner_store_access_context context
set
  owner_employee_id = employee.id,
  owner_role_id = role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'owner'
where employee.organization_id = context.organization_id
  and employee.profile_id = '8b800000-0000-4000-8000-000000000001';

with inserted_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Owner Store Access Secondary', 'OWNER-SECONDARY'
  from owner_store_access_context
  returning id
)
update owner_store_access_context
set secondary_store_id = (select id from inserted_store);

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '8b800000-0000-4000-8000-000000000002', 'OWNER-CUSTOM-001', 'Custom organization manager'
from owner_store_access_context;

insert into public.roles (id, organization_id, name, code, is_system)
select custom_role_id, organization_id, 'Custom organization manager', 'custom_organization_manager', false
from owner_store_access_context;

insert into public.role_permissions (organization_id, role_id, permission_code)
select organization_id, custom_role_id, permission_code
from owner_store_access_context
cross join unnest(array['employees.manage', 'organization.manage']::text[]) permission_code;

with assigned_role as (
  insert into public.employee_roles (organization_id, employee_id, role_id)
  select employee.organization_id, employee.id, context.custom_role_id
  from public.employees employee
  join owner_store_access_context context on context.organization_id = employee.organization_id
  where employee.profile_id = '8b800000-0000-4000-8000-000000000002'
  returning employee_id
)
update owner_store_access_context
set custom_employee_id = (select employee_id from assigned_role);

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '8b800000-0000-4000-8000-000000000003', 'OWNER-SCOPED-001', 'Scoped store manager'
from owner_store_access_context;

insert into public.roles (id, organization_id, name, code, is_system)
select scoped_role_id, organization_id, 'Scoped store manager', 'scoped_store_manager', false
from owner_store_access_context;

insert into public.role_permissions (organization_id, role_id, permission_code)
select organization_id, scoped_role_id, permission_code
from owner_store_access_context
cross join unnest(array['employees.manage', 'stores.manage']::text[]) permission_code;

with assigned_role as (
  insert into public.employee_roles (organization_id, employee_id, role_id)
  select employee.organization_id, employee.id, context.scoped_role_id
  from public.employees employee
  join owner_store_access_context context on context.organization_id = employee.organization_id
  where employee.profile_id = '8b800000-0000-4000-8000-000000000003'
  returning employee_id
), assigned_store as (
  insert into public.employee_stores (organization_id, employee_id, store_id)
  select context.organization_id, role.employee_id, context.primary_store_id
  from assigned_role role
  cross join owner_store_access_context context
  returning employee_id
)
update owner_store_access_context
set scoped_employee_id = (select employee_id from assigned_store);

with inserted_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Owner Store Access Tertiary', 'OWNER-TERTIARY'
  from owner_store_access_context
  returning id
)
update owner_store_access_context
set tertiary_store_id = (select id from inserted_store);

create or replace function pg_temp.owner_self_edit_succeeds()
returns boolean
language plpgsql
as $$
begin
  perform public.update_employee_assignments(
    (select organization_id from owner_store_access_context),
    (select owner_employee_id from owner_store_access_context),
    'Organization owner',
    'active',
    array[(select owner_role_id from owner_store_access_context)],
    array[(select primary_store_id from owner_store_access_context)]
  );
  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function pg_temp.duplicate_owner_store_assignment_is_idempotent()
returns boolean
language plpgsql
as $$
begin
  insert into public.employee_stores (organization_id, employee_id, store_id)
  select organization_id, owner_employee_id, secondary_store_id
  from owner_store_access_context;
  return true;
exception
  when others then
    return false;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '8b800000-0000-4000-8000-000000000001';

select ok(
  to_regprocedure('private.sync_organization_manager_store_access(uuid,uuid)') is not null,
  'the internal capability-based organization-manager store sync exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.sync_organization_manager_store_access(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot invoke the internal store-assignment helper directly'
);

select is(
  (select count(*)::integer from public.employee_stores assignment
    join owner_store_access_context context
      on context.organization_id = assignment.organization_id
     and context.owner_employee_id = assignment.employee_id),
  3,
  'an organization manager receives existing and newly created active stores'
);

select is(
  (select count(*)::integer from public.employee_stores assignment
    join owner_store_access_context context
      on context.organization_id = assignment.organization_id
     and context.custom_employee_id = assignment.employee_id),
  3,
  'a customer-created role with organization.manage receives organization-wide store access'
);

select is(
  (select count(*)::integer from public.employee_stores assignment
    join owner_store_access_context context
      on context.organization_id = assignment.organization_id
     and context.scoped_employee_id = assignment.employee_id),
  1,
  'stores.manage alone does not create organization-wide employee assignments'
);

select ok(
  pg_temp.owner_self_edit_succeeds(),
  'an organization manager can safely update their own non-security employee record'
);

select ok(
  pg_temp.duplicate_owner_store_assignment_is_idempotent(),
  'legacy assignment flows remain safe when automatic owner access already exists'
);

select * from finish();
rollback;
