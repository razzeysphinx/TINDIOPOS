begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('9b900000-0000-4000-8000-000000000001', 'rbac-matrix-owner@tindio.test', '{"full_name":"RBAC Matrix Owner"}'::jsonb),
  ('9b900000-0000-4000-8000-000000000002', 'rbac-matrix-admin@tindio.test', '{"full_name":"RBAC Matrix Admin"}'::jsonb),
  ('9b900000-0000-4000-8000-000000000003', 'rbac-matrix-manager@tindio.test', '{"full_name":"RBAC Matrix Manager"}'::jsonb),
  ('9b900000-0000-4000-8000-000000000004', 'rbac-matrix-cashier@tindio.test', '{"full_name":"RBAC Matrix Cashier"}'::jsonb),
  ('9b900000-0000-4000-8000-000000000005', 'rbac-matrix-staff@tindio.test', '{"full_name":"RBAC Matrix Staff"}'::jsonb),
  ('9b900000-0000-4000-8000-000000000006', 'rbac-matrix-custom@tindio.test', '{"full_name":"RBAC Matrix Custom"}'::jsonb);

create temporary table rbac_permission_matrix_context (
  organization_id uuid not null,
  primary_store_id uuid not null,
  secondary_store_id uuid,
  product_id uuid,
  custom_role_id uuid not null default '9b900000-0000-4000-8000-000000000099'::uuid
);

grant select, insert, update on table rbac_permission_matrix_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '9b900000-0000-4000-8000-000000000001';

insert into rbac_permission_matrix_context (organization_id, primary_store_id)
select organization_id, store_id
from public.bootstrap_organization(
  'RBAC Permission Matrix Retail',
  'RBAC Permission Matrix Main',
  'RBAC Permission Matrix Counter'
);

update rbac_permission_matrix_context
set product_id = public.create_catalog_product_v2(
  organization_id,
  null,
  'RBAC scope product',
  '',
  'simple',
  'RBAC-MATRIX-1',
  '480000009900',
  100,
  40,
  false,
  'each',
  array[primary_store_id],
  '[]'::jsonb,
  '',
  false,
  false
);

reset role;

with inserted_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'RBAC Permission Matrix Secondary', 'RBAC-MATRIX-2'
  from rbac_permission_matrix_context
  returning id
)
update rbac_permission_matrix_context
set secondary_store_id = (select id from inserted_store);

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select context.organization_id, assignment.profile_id, assignment.employee_number, assignment.job_title
from rbac_permission_matrix_context context
cross join (
  values
    ('9b900000-0000-4000-8000-000000000002'::uuid, 'RBAC-ADMIN', 'Admin'),
    ('9b900000-0000-4000-8000-000000000003'::uuid, 'RBAC-MANAGER', 'Manager'),
    ('9b900000-0000-4000-8000-000000000004'::uuid, 'RBAC-CASHIER', 'Cashier'),
    ('9b900000-0000-4000-8000-000000000005'::uuid, 'RBAC-STAFF', 'Inventory staff'),
    ('9b900000-0000-4000-8000-000000000006'::uuid, 'RBAC-CUSTOM', 'Custom catalog role')
) as assignment(profile_id, employee_number, job_title);

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join rbac_permission_matrix_context context
  on context.organization_id = employee.organization_id
join (
  values
    ('9b900000-0000-4000-8000-000000000002'::uuid, 'admin'::text),
    ('9b900000-0000-4000-8000-000000000003'::uuid, 'manager'::text),
    ('9b900000-0000-4000-8000-000000000004'::uuid, 'cashier'::text),
    ('9b900000-0000-4000-8000-000000000005'::uuid, 'inventory_staff'::text)
) as assignment(profile_id, role_code)
  on assignment.profile_id = employee.profile_id
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = assignment.role_code;

insert into public.roles (id, organization_id, name, code, is_system)
select custom_role_id, organization_id, 'Custom catalog editor', 'custom_catalog_editor', false
from rbac_permission_matrix_context;

insert into public.role_permissions (organization_id, role_id, permission_code)
select organization_id, custom_role_id, 'products.manage'
from rbac_permission_matrix_context;

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, context.custom_role_id
from public.employees employee
join rbac_permission_matrix_context context
  on context.organization_id = employee.organization_id
where employee.profile_id = '9b900000-0000-4000-8000-000000000006';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.primary_store_id
from public.employees employee
cross join rbac_permission_matrix_context context
where employee.organization_id = context.organization_id
  and employee.profile_id in (
    '9b900000-0000-4000-8000-000000000003',
    '9b900000-0000-4000-8000-000000000004',
    '9b900000-0000-4000-8000-000000000005',
    '9b900000-0000-4000-8000-000000000006'
  );

-- Remove redundant legacy assignment rows. The Owner and Admin must retain
-- their organization-wide access entirely through stores.manage.
delete from public.employee_stores assignment
using public.employees employee
join rbac_permission_matrix_context context
  on context.organization_id = employee.organization_id
where assignment.organization_id = employee.organization_id
  and assignment.employee_id = employee.id
  and employee.profile_id in (
    '9b900000-0000-4000-8000-000000000001',
    '9b900000-0000-4000-8000-000000000002'
  );

create or replace function pg_temp.can_write_store_configuration(
  target_store_id uuid,
  target_low_stock_level integer
)
returns boolean
language plpgsql
as $$
begin
  insert into public.product_store_settings (
    organization_id,
    product_id,
    store_id,
    is_available,
    price_override_minor,
    low_stock_level
  )
  select
    organization_id,
    product_id,
    target_store_id,
    true,
    12500,
    target_low_stock_level
  from rbac_permission_matrix_context
  on conflict (store_id, product_id) do update
  set price_override_minor = excluded.price_override_minor,
      low_stock_level = excluded.low_stock_level;
  return true;
exception
  when insufficient_privilege then
    return false;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '9b900000-0000-4000-8000-000000000001';

select ok(
  to_regprocedure('private.has_organization_store_scope(uuid)') is not null,
  'the database exposes one internal capability-based organization store-scope predicate'
);

select ok(
  not has_function_privilege('authenticated', 'private.has_organization_store_scope(uuid)', 'EXECUTE'),
  'authenticated callers cannot invoke the internal organization-scope predicate directly'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind = 'r'
      and not relation.relrowsecurity
  ),
  'every public application table keeps row-level security enabled'
);

select ok(
  not has_function_privilege('anon', 'private.default_legacy_transfer_line_received_quantity()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.grant_cashier_ticket_capability()', 'EXECUTE'),
  'anonymous callers cannot directly execute internal trigger procedures'
);

select is(
  (
    select string_agg(procedure.proname, ',' order by procedure.proname)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.prosecdef
      and namespace.nspname = 'public'
      and has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ),
  'get_customer_display_bootstrap,get_customer_display_receipt,get_public_smart_menu,verify_loyalty_card_qr',
  'anonymous security-definer RPCs are restricted to the intended tokenized/public read endpoints'
);

select is(
  (
    select count(*)::integer
    from public.permissions permission
    where not exists (
      select 1
      from public.roles role
      join public.role_permissions role_permission
        on role_permission.organization_id = role.organization_id
       and role_permission.role_id = role.id
       and role_permission.permission_code = permission.code
      where role.organization_id = (select organization_id from rbac_permission_matrix_context)
        and role.is_system
        and role.code = 'owner'
    )
  ),
  0,
  'Owner contains every registered organization capability'
);

select is(
  (
    select count(*)::integer
    from public.employee_stores assignment
    join public.employees employee
      on employee.id = assignment.employee_id
     and employee.organization_id = assignment.organization_id
    where employee.profile_id = '9b900000-0000-4000-8000-000000000001'
  ),
  0,
  'Owner does not require employee-store assignments for organization-wide access'
);

select ok(
  exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
     and permission.permission_code = 'stores.manage'
    where role.organization_id = (select organization_id from rbac_permission_matrix_context)
      and role.is_system
      and role.code = 'admin'
  ),
  'Admin has the organization-wide stores.manage capability'
);

select ok(
  not exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
     and permission.permission_code = 'recovery.manage'
    where role.organization_id = (select organization_id from rbac_permission_matrix_context)
      and role.is_system
      and role.code = 'admin'
  ),
  'Admin does not receive the intentional owner-only recovery-management capability'
);

select ok(
  exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
     and permission.permission_code = 'products.manage'
    where role.organization_id = (select organization_id from rbac_permission_matrix_context)
      and role.is_system
      and role.code = 'manager'
  )
  and not exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
     and permission.permission_code = 'stores.manage'
    where role.organization_id = (select organization_id from rbac_permission_matrix_context)
      and role.is_system
      and role.code = 'manager'
  ),
  'Manager has catalog capability but remains store-assignment scoped'
);

select ok(
  not exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
     and permission.permission_code = 'products.manage'
    where role.organization_id = (select organization_id from rbac_permission_matrix_context)
      and role.is_system
      and role.code = 'cashier'
  ),
  'Cashier lacks catalog-administration capability'
);

select ok(
  exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
     and permission.permission_code = 'products.manage'
    where role.organization_id = (select organization_id from rbac_permission_matrix_context)
      and role.is_system
      and role.code = 'inventory_staff'
  ),
  'Inventory Staff receives its catalog and inventory capability bundle'
);

select is(
  (
    select count(*)::integer
    from public.role_permissions permission
    join rbac_permission_matrix_context context
      on context.organization_id = permission.organization_id
     and context.custom_role_id = permission.role_id
  ),
  1,
  'Custom role receives exactly its configured permission bundle without a preset role name'
);

select ok(
  pg_temp.can_write_store_configuration(
    (select secondary_store_id from rbac_permission_matrix_context),
    11
  ),
  'Owner can change a secondary-store price and low-stock setting without an employee-store row'
);

set local request.jwt.claim.sub = '9b900000-0000-4000-8000-000000000002';
select ok(
  pg_temp.can_write_store_configuration(
    (select secondary_store_id from rbac_permission_matrix_context),
    12
  ),
  'Admin receives the same organization-wide store scope through stores.manage, not a role-name exception'
);

set local request.jwt.claim.sub = '9b900000-0000-4000-8000-000000000003';
select ok(
  pg_temp.can_write_store_configuration(
    (select primary_store_id from rbac_permission_matrix_context),
    13
  ),
  'Manager can change a product setting in an assigned store'
);
select ok(
  not pg_temp.can_write_store_configuration(
    (select secondary_store_id from rbac_permission_matrix_context),
    14
  ),
  'Manager is denied an unassigned store despite product-management capability'
);

set local request.jwt.claim.sub = '9b900000-0000-4000-8000-000000000004';
select ok(
  not pg_temp.can_write_store_configuration(
    (select primary_store_id from rbac_permission_matrix_context),
    15
  ),
  'Cashier is denied catalog store settings in an assigned store without products.manage'
);

set local request.jwt.claim.sub = '9b900000-0000-4000-8000-000000000005';
select ok(
  pg_temp.can_write_store_configuration(
    (select primary_store_id from rbac_permission_matrix_context),
    16
  ),
  'Inventory Staff can change a product setting in its assigned store'
);
select ok(
  not pg_temp.can_write_store_configuration(
    (select secondary_store_id from rbac_permission_matrix_context),
    17
  ),
  'Inventory Staff is denied product settings outside its assigned store'
);

set local request.jwt.claim.sub = '9b900000-0000-4000-8000-000000000006';
select ok(
  pg_temp.can_write_store_configuration(
    (select primary_store_id from rbac_permission_matrix_context),
    18
  ),
  'Custom product-management role works through the same capability and assigned-store rules'
);
select ok(
  not pg_temp.can_write_store_configuration(
    (select secondary_store_id from rbac_permission_matrix_context),
    19
  ),
  'Custom role is denied outside its assigned store until stores.manage is explicitly granted'
);

select * from finish();
rollback;
