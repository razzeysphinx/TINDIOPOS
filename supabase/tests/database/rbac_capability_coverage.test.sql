begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('7b700000-0000-4000-8000-000000000001', 'rbac-capability-owner@tindio.test', '{"full_name":"RBAC Capability Owner"}'::jsonb),
  ('7b700000-0000-4000-8000-000000000002', 'rbac-capability-custom@tindio.test', '{"full_name":"RBAC Capability Custom"}'::jsonb);

create temporary table rbac_capability_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  custom_role_id uuid not null
);

grant select, insert on table rbac_capability_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '7b700000-0000-4000-8000-000000000001';

insert into rbac_capability_context (organization_id, store_id, register_id, custom_role_id)
select organization_id, store_id, register_id, '7b700000-0000-4000-8000-000000000099'::uuid
from public.bootstrap_organization('RBAC Capability Retail', 'RBAC Capability Main', 'RBAC Capability Counter');

reset role;

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '7b700000-0000-4000-8000-000000000002', 'RBAC-CUSTOM-001', 'Custom POS role'
from rbac_capability_context;

insert into public.roles (id, organization_id, name, code, is_system)
select custom_role_id, organization_id, 'Checkout-only custom role', 'checkout_only_custom', false
from rbac_capability_context;

insert into public.role_permissions (organization_id, role_id, permission_code)
select context.organization_id, context.custom_role_id, permission_code
from rbac_capability_context context
cross join unnest(array['pos.access', 'sales.create', 'payments.accept']::text[]) permission_code;

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, context.custom_role_id
from public.employees employee
join rbac_capability_context context on context.organization_id = employee.organization_id
where employee.profile_id = '7b700000-0000-4000-8000-000000000002';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join rbac_capability_context context on context.organization_id = employee.organization_id
where employee.profile_id = '7b700000-0000-4000-8000-000000000002';

create or replace function pg_temp.discount_capability_is_enforced()
returns boolean
language plpgsql
as $$
begin
  perform *
  from public.checkout_advanced_sale(
    (select organization_id from rbac_capability_context),
    (select store_id from rbac_capability_context),
    (select register_id from rbac_capability_context),
    '7b700000-0000-4000-8000-000000000010'::uuid,
    '[]'::jsonb,
    '[]'::jsonb,
    null,
    0,
    '7b700000-0000-4000-8000-000000000011'::uuid,
    null,
    null,
    null
  );
  return false;
exception
  when insufficient_privilege then
    return sqlerrm like '%discounts.apply%';
end;
$$;

create or replace function pg_temp.ticket_capability_is_enforced()
returns boolean
language plpgsql
as $$
begin
  perform *
  from public.get_pos_open_tickets(
    (select organization_id from rbac_capability_context),
    (select store_id from rbac_capability_context),
    (select register_id from rbac_capability_context)
  );
  return false;
exception
  when insufficient_privilege then
    return sqlerrm like '%tickets.manage%';
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '7b700000-0000-4000-8000-000000000002';

select is(
  (select count(*)::integer from public.role_permissions permission
    join rbac_capability_context context
      on context.organization_id = permission.organization_id
     and context.custom_role_id = permission.role_id),
  3,
  'a customer-created role uses its own permission bundle without a preset role name'
);

select ok(
  pg_temp.discount_capability_is_enforced(),
  'direct checkout cannot apply a discount without discounts.apply'
);

select ok(
  pg_temp.ticket_capability_is_enforced(),
  'direct open-ticket RPC cannot read tickets without tickets.manage'
);

select ok(
  exists (
    select 1
    from public.roles role
    join public.role_permissions permission
      on permission.organization_id = role.organization_id
     and permission.role_id = role.id
    join rbac_capability_context context
      on context.organization_id = role.organization_id
    where role.is_system
      and role.code = 'cashier'
      and permission.permission_code = 'tickets.manage'
  ),
  'the predefined Cashier bundle includes its intended open-ticket capability'
);

select * from finish();
rollback;
