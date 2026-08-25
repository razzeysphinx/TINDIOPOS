begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select ok(to_regclass('public.kitchen_orders') is not null, 'kitchen orders table exists');
select ok(to_regclass('public.kitchen_order_items') is not null, 'kitchen order items table exists');
select is(
  (select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'public' and relation.relname in ('kitchen_orders', 'kitchen_order_items') and relation.relrowsecurity),
  2::bigint,
  'RLS is enabled on every Phase 12 table'
);
select ok(to_regclass('public.kitchen_orders_active_queue_idx') is not null, 'active kitchen queue index exists');
select ok(to_regprocedure('public.get_kitchen_orders(uuid,uuid)') is not null, 'kitchen order lookup routine exists');
select ok(to_regprocedure('public.update_kitchen_order_status(uuid,uuid,text)') is not null, 'kitchen status routine exists');
select ok(not has_table_privilege('anon', 'public.kitchen_orders', 'select'), 'anonymous callers cannot read kitchen orders directly');
select ok(not has_table_privilege('authenticated', 'public.kitchen_order_items', 'select'), 'authenticated callers cannot read kitchen items directly');
select ok(not has_function_privilege('anon', 'public.get_kitchen_orders(uuid,uuid)', 'execute'), 'anonymous callers cannot access the kitchen queue routine');
select ok(not has_function_privilege('anon', 'public.update_kitchen_order_status(uuid,uuid,text)', 'execute'), 'anonymous callers cannot update kitchen orders');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'kitchen_display_receive_broadcasts'), 'private kitchen Realtime receive policy exists');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('c1111111-1111-4111-8111-111111111111', 'kitchen-owner@tindio.test', '{"full_name":"Kitchen Owner"}'::jsonb),
  ('c2222222-2222-4222-8222-222222222222', 'kitchen-outsider@tindio.test', '{"full_name":"Kitchen Outsider"}'::jsonb);

create temporary table kitchen_test_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  product_id uuid,
  dining_option_id uuid,
  sale_id uuid,
  kitchen_order_id uuid
);

grant select, insert, update on kitchen_test_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'c1111111-1111-4111-8111-111111111111';

insert into kitchen_test_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Kitchen Test Retail', 'Kitchen Main', 'Kitchen Counter');

select ok(
  exists (
    select 1
    from public.role_permissions role_permission
    join public.employees employee on employee.organization_id = role_permission.organization_id
    join public.employee_roles employee_role on employee_role.organization_id = employee.organization_id and employee_role.employee_id = employee.id and employee_role.role_id = role_permission.role_id
    where employee.profile_id = 'c1111111-1111-4111-8111-111111111111'
      and role_permission.permission_code = 'kitchen.manage'
  ),
  'new organization owner receives kitchen management permission'
);

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, null)$$,
    (select organization_id from kitchen_test_context),
    (select store_id from kitchen_test_context),
    (select register_id from kitchen_test_context)
  ),
  'owner opens the register shift before kitchen checkout'
);

update kitchen_test_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Kitchen Test Bowl',
  'Kitchen order fixture',
  'simple',
  'KITCHEN-BOWL',
  '480000120001',
  18000,
  6000,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

with option_row as (
  insert into public.dining_options (organization_id, name, is_default, sort_order)
  select organization_id, 'Dine in', true, 0
  from kitchen_test_context
  returning id
)
update kitchen_test_context
set dining_option_id = option_row.id
from option_row;

update kitchen_test_context context
set sale_id = (
  select sale_id
  from public.checkout_advanced_sale(
    context.organization_id,
    context.store_id,
    context.register_id,
    'c3333333-3333-4333-8333-333333333333',
    jsonb_build_array(jsonb_build_object(
      'product_id', context.product_id,
      'variant_id', null,
      'quantity', 2,
      'modifier_option_ids', '[]'::jsonb
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (
        select id from public.payment_methods
        where organization_id = context.organization_id and code = 'CASH'
      ),
      'amount_tendered_minor', 40000
    )),
    null,
    0,
    null,
    null,
    context.dining_option_id,
    null
  )
);

update kitchen_test_context context
set kitchen_order_id = (
  select kitchen_order_id
  from public.get_kitchen_orders(context.organization_id, context.store_id)
  limit 1
);

select ok((select kitchen_order_id is not null from kitchen_test_context), 'completed dining sale issues one kitchen order atomically');
select is(
  (select count(*) from public.get_kitchen_orders((select organization_id from kitchen_test_context), (select store_id from kitchen_test_context))),
  1::bigint,
  'assigned kitchen user sees the queued order'
);
select is(
  (select status from public.get_kitchen_orders((select organization_id from kitchen_test_context), (select store_id from kitchen_test_context))),
  'NEW',
  'newly issued kitchen order begins in NEW status'
);
select is(
  (select (items -> 0 ->> 'name') from public.get_kitchen_orders((select organization_id from kitchen_test_context), (select store_id from kitchen_test_context))),
  'Kitchen Test Bowl',
  'kitchen order preserves the sale item snapshot'
);
select is(
  (select (items -> 0 ->> 'quantity')::integer from public.get_kitchen_orders((select organization_id from kitchen_test_context), (select store_id from kitchen_test_context))),
  2,
  'kitchen order preserves the sale quantity snapshot'
);

create or replace function pg_temp.kitchen_status_skip_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.update_kitchen_order_status(
    (select organization_id from kitchen_test_context),
    (select kitchen_order_id from kitchen_test_context),
    'READY'
  );
  return false;
exception when check_violation then
  return true;
end;
$$;

select ok(pg_temp.kitchen_status_skip_is_rejected(), 'kitchen orders cannot skip status transitions');
select lives_ok(
  format(
    $$select public.update_kitchen_order_status(%L, %L, 'PREPARING')$$,
    (select organization_id from kitchen_test_context),
    (select kitchen_order_id from kitchen_test_context)
  ),
  'kitchen manager starts preparing the order'
);
select is(
  (select status from public.get_kitchen_orders((select organization_id from kitchen_test_context), (select store_id from kitchen_test_context))),
  'PREPARING',
  'preparing transition persists'
);
select lives_ok(
  format(
    $$select public.update_kitchen_order_status(%L, %L, 'READY')$$,
    (select organization_id from kitchen_test_context),
    (select kitchen_order_id from kitchen_test_context)
  ),
  'kitchen manager marks the order ready'
);
select lives_ok(
  format(
    $$select public.update_kitchen_order_status(%L, %L, 'COMPLETED')$$,
    (select organization_id from kitchen_test_context),
    (select kitchen_order_id from kitchen_test_context)
  ),
  'kitchen manager completes the order'
);
select is(
  (select status from public.get_kitchen_orders((select organization_id from kitchen_test_context), (select store_id from kitchen_test_context))),
  'COMPLETED',
  'completed transition remains visible for the recent kitchen history'
);

create or replace function pg_temp.outsider_kitchen_access_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_kitchen_orders((select organization_id from kitchen_test_context), (select store_id from kitchen_test_context));
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;

set local request.jwt.claim.sub = 'c2222222-2222-4222-8222-222222222222';
select ok(pg_temp.outsider_kitchen_access_is_rejected(), 'unassigned users cannot read a store kitchen queue');

select * from finish();
rollback;
