begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  to_regprocedure('public.create_store_scoped_payment_method(uuid,text,text,text,boolean,uuid[])') is not null
  and to_regprocedure('public.update_payment_method_configuration(uuid,uuid,text,boolean,boolean,integer)') is not null
  and to_regprocedure('public.set_store_payment_method_configuration(uuid,uuid,uuid,boolean)') is not null,
  'atomic payment configuration RPCs exist'
);
select ok(
  not has_table_privilege('authenticated', 'public.payment_methods', 'insert'),
  'clients cannot insert payment methods directly'
);
select ok(
  not has_column_privilege('authenticated', 'public.payment_methods', 'name', 'update'),
  'clients cannot update payment methods directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.store_payment_methods', 'insert')
  and not has_column_privilege('authenticated', 'public.store_payment_methods', 'is_enabled', 'update'),
  'clients cannot configure store mappings directly'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('e5000000-0000-4000-8000-000000000001', 'payment-config-owner@tindio.test', '{"full_name":"Payment Config Owner"}'::jsonb),
  ('e5000000-0000-4000-8000-000000000002', 'payment-config-cashier@tindio.test', '{"full_name":"Payment Config Cashier"}'::jsonb);

create temporary table payment_config_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  custom_method_id uuid
);

grant select, insert, update on payment_config_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000001';

insert into payment_config_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization(
  'Payment Configuration Retail',
  'Payment Configuration Main',
  'Payment Configuration Counter'
);

update payment_config_context
set custom_method_id = public.create_store_scoped_payment_method(
  organization_id,
  'QR Wallet',
  'QR_WALLET',
  'E_WALLET',
  true,
  array[store_id]
);

select ok(
  (select custom_method_id is not null from payment_config_context),
  'settings manager can create a payment method atomically'
);
select ok(
  exists (
    select 1
    from public.payment_methods method
    join payment_config_context context
      on context.organization_id = method.organization_id
     and context.custom_method_id = method.id
    where method.code = 'QR_WALLET'
      and method.payment_type = 'E_WALLET'
      and method.requires_reference
  ),
  'created method preserves its stable code, category, and reference rule'
);
select is(
  (
    select count(*)
    from public.store_payment_methods mapping
    join payment_config_context context
      on context.organization_id = mapping.organization_id
     and context.store_id = mapping.store_id
     and context.custom_method_id = mapping.payment_method_id
    where mapping.is_enabled
  ),
  1::bigint,
  'created method is enabled at every selected active store in the same transaction'
);

select throws_ok(
  format(
    $$select public.create_store_scoped_payment_method(%L, 'Invalid Wallet', 'INVALID_WALLET', 'E_WALLET', false, array['e5000000-0000-4000-8000-000000000099'::uuid])$$,
    (select organization_id from payment_config_context)
  ),
  '23514',
  'Select one or more unique active stores in this organization.',
  'a payment method cannot be created for an invalid or inactive store'
);
select is(
  (
    select count(*)
    from public.payment_methods method
    join payment_config_context context on context.organization_id = method.organization_id
    where method.code = 'INVALID_WALLET'
  ),
  0::bigint,
  'a rejected store mapping leaves no partial payment method behind'
);

select lives_ok(
  format(
    $$select public.update_payment_method_configuration(%L, %L, 'QR Wallet Manual', true, false, 73)$$,
    (select organization_id from payment_config_context),
    (select custom_method_id from payment_config_context)
  ),
  'settings manager can update safe payment configuration'
);
select ok(
  exists (
    select 1
    from public.payment_methods method
    join payment_config_context context
      on context.organization_id = method.organization_id
     and context.custom_method_id = method.id
    where method.name = 'QR Wallet Manual'
      and method.is_enabled
      and not method.requires_reference
      and method.sort_order = 73
      and method.code = 'QR_WALLET'
      and method.payment_type = 'E_WALLET'
  ),
  'configuration updates cannot rewrite the method code or cash-accounting category'
);

select lives_ok(
  format(
    $$select public.set_store_payment_method_configuration(%L, %L, %L, false)$$,
    (select organization_id from payment_config_context),
    (select store_id from payment_config_context),
    (select custom_method_id from payment_config_context)
  ),
  'settings manager can change active-store availability'
);
select ok(
  exists (
    select 1
    from public.payment_methods method
    join public.store_payment_methods mapping
      on mapping.organization_id = method.organization_id
     and mapping.payment_method_id = method.id
    join payment_config_context context
      on context.organization_id = method.organization_id
     and context.store_id = mapping.store_id
     and context.custom_method_id = method.id
    where method.is_enabled
      and not mapping.is_enabled
  ),
  'store disabling does not rewrite the globally configured payment method'
);

reset role;
insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'e5000000-0000-4000-8000-000000000002', 'PAYMENT-CASHIER-002', 'Cashier'
from payment_config_context;

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = 'e5000000-0000-4000-8000-000000000002';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join payment_config_context context on context.organization_id = employee.organization_id
where employee.profile_id = 'e5000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';

select throws_ok(
  format(
    $$select public.update_payment_method_configuration(%L, %L, 'Cashier Change', true, false, 74)$$,
    (select organization_id from payment_config_context),
    (select custom_method_id from payment_config_context)
  ),
  '42501',
  'Settings permission is required to configure payment methods.',
  'a cashier cannot reconfigure payment methods'
);

select * from finish();
rollback;
