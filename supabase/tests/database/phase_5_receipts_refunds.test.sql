begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

select has_table('public', 'refunds', 'refunds table exists');
select has_table('public', 'refund_items', 'refund items table exists');
select has_table('public', 'refund_payments', 'refund payments table exists');
select has_table('public', 'refund_requests', 'refund idempotency table exists');

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('refunds', 'refund_items', 'refund_payments', 'refund_requests')
      and relation.relrowsecurity
  ),
  4::bigint,
  'RLS is enabled on every Phase 5 table'
);

select ok(
  pg_get_constraintdef(
    (
      select constraint_row.oid
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conname = 'inventory_movements_type_values'
        and constraint_row.conrelid = 'public.inventory_movements'::regclass
    )
  ) like '%REFUND%',
  'inventory movements accept the REFUND ledger type'
);

select ok(
  to_regprocedure('public.refund_sale(uuid,uuid,uuid,uuid,text,text,jsonb,uuid)') is not null,
  'atomic refund routine exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.refund_sale(uuid,uuid,uuid,uuid,text,text,jsonb,uuid)',
    'execute'
  ),
  'anonymous callers cannot execute refunds'
);
select ok(
  not has_table_privilege('authenticated', 'public.refunds', 'insert'),
  'authenticated callers cannot insert refund headers directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_items', 'insert'),
  'authenticated callers cannot insert refund lines directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_payments', 'insert'),
  'authenticated callers cannot insert refund payments directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.refund_requests', 'select'),
  'authenticated callers cannot inspect refund idempotency records'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '41414141-4141-4414-8414-414141414141',
    'refund-owner@tindio.test',
    '{"full_name":"Refund Owner"}'::jsonb
  ),
  (
    '42424242-4242-4424-8424-424242424242',
    'refund-cashier@tindio.test',
    '{"full_name":"Refund Cashier"}'::jsonb
  ),
  (
    '43434343-4343-4434-8434-434343434343',
    'refund-other-owner@tindio.test',
    '{"full_name":"Other Refund Owner"}'::jsonb
  );

create temporary table refund_test_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  tracked_product_id uuid,
  untracked_product_id uuid,
  sale_id uuid,
  cashier_employee_id uuid
);

create temporary table refund_test_result (
  label text primary key,
  refund_id uuid not null,
  refund_number bigint not null,
  total_minor bigint not null,
  was_replayed boolean not null
);

grant select, insert, update on table refund_test_context, refund_test_result
to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '41414141-4141-4414-8414-414141414141';

insert into refund_test_context (label, organization_id, store_id, register_id)
select 'refund', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Refund Test Retail',
  'Refund Test Main',
  'Refund Test Counter'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '43434343-4343-4434-8434-434343434343';

insert into refund_test_context (label, organization_id, store_id, register_id)
select 'other', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Other Refund Retail',
  'Other Refund Main',
  'Other Refund Counter'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '41414141-4141-4414-8414-414141414141';

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'Refund Tests', 1
  from refund_test_context
  where label = 'refund'
  returning id
)
update refund_test_context
set category_id = (select id from inserted_category)
where label = 'refund';

update refund_test_context
set tracked_product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Refund Tracked Item',
  'Tracked refund test product',
  'simple',
  'REFUND-TRACKED',
  '480000060001',
  1000,
  400,
  true,
  'each',
  array[store_id],
  '[]'::jsonb
)
where label = 'refund';

update refund_test_context
set untracked_product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Refund Service Item',
  'Untracked refund test product',
  'simple',
  'REFUND-SERVICE',
  '480000060002',
  500,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
)
where label = 'refund';

select public.create_inventory_adjustment_reason(
  (select organization_id from refund_test_context where label = 'refund'),
  'OPENING_STOCK',
  'Opening stock',
  'OPENING_STOCK'
);

select lives_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, 10, 'OPENING_STOCK', 'Initial refund stock', gen_random_uuid(), null)$$,
    (select organization_id from refund_test_context where label = 'refund'),
    (select store_id from refund_test_context where label = 'refund'),
    (select tracked_product_id from refund_test_context where label = 'refund')
  ),
  'owner can initialize tracked stock before a refundable sale'
);

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 5000, 'Refund test opening float')$$,
    (select organization_id from refund_test_context where label = 'refund'),
    (select store_id from refund_test_context where label = 'refund'),
    (select register_id from refund_test_context where label = 'refund')
  ),
  'owner can open a register shift before a refundable sale'
);

update refund_test_context context
set sale_id = checkout.sale_id
from public.checkout_sale(
  (select organization_id from refund_test_context where label = 'refund'),
  (select store_id from refund_test_context where label = 'refund'),
  (select register_id from refund_test_context where label = 'refund'),
  '44444444-4444-4444-8444-444444444444',
  jsonb_build_array(
    jsonb_build_object(
      'product_id', (select tracked_product_id from refund_test_context where label = 'refund'),
      'variant_id', null,
      'quantity', 2
    ),
    jsonb_build_object(
      'product_id', (select untracked_product_id from refund_test_context where label = 'refund'),
      'variant_id', null,
      'quantity', 1
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'payment_method_id', (
        select id
        from public.payment_methods
        where organization_id = (select organization_id from refund_test_context where label = 'refund')
          and code = 'CASH'
      ),
      'amount_tendered_minor', 2500
    )
  )
) checkout
where context.label = 'refund';

select is(
  (select total_minor from public.sales where id = (select sale_id from refund_test_context where label = 'refund')),
  2500::bigint,
  'source sale is completed with server-calculated total'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id = (select organization_id from refund_test_context where label = 'refund')
      and store_id = (select store_id from refund_test_context where label = 'refund')
      and product_id = (select tracked_product_id from refund_test_context where label = 'refund')
      and variant_id is null
  ),
  8.000::numeric,
  'source sale deducts tracked stock before refund'
);

insert into refund_test_result
select 'partial', refund.*
from public.refund_sale(
  (select organization_id from refund_test_context where label = 'refund'),
  (select sale_id from refund_test_context where label = 'refund'),
  (
    select id
    from public.payment_methods
    where organization_id = (select organization_id from refund_test_context where label = 'refund')
      and code = 'CARD'
  ),
  '45454545-4545-4454-8454-454545454545',
  'Customer returned one item',
  'CARD-REFUND-1',
  jsonb_build_array(jsonb_build_object(
    'sale_item_id', (
      select id
      from public.sale_items
      where sale_id = (select sale_id from refund_test_context where label = 'refund')
        and product_id = (select tracked_product_id from refund_test_context where label = 'refund')
    ),
    'quantity', 1
  ))
) refund;

select is(
  (select total_minor from refund_test_result where label = 'partial'),
  1000::bigint,
  'partial refund total is derived from the original sale line'
);
select ok(
  (select refund_number > 0 from refund_test_result where label = 'partial'),
  'partial refund receives a refund number'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id = (select organization_id from refund_test_context where label = 'refund')
      and store_id = (select store_id from refund_test_context where label = 'refund')
      and product_id = (select tracked_product_id from refund_test_context where label = 'refund')
      and variant_id is null
  ),
  9.000::numeric,
  'partial refund restores only the returned tracked quantity'
);
select is(
  (
    select count(*)
    from public.inventory_movements
    where source_id = (select refund_id from refund_test_result where label = 'partial')
      and source_type = 'refund'
      and movement_type = 'REFUND'
      and quantity_delta = 1
      and quantity_after = quantity_before + quantity_delta
  ),
  1::bigint,
  'partial refund records a balanced REFUND movement'
);
select is(
  (
    select amount_minor
    from public.refund_payments
    where refund_id = (select refund_id from refund_test_result where label = 'partial')
  ),
  1000::bigint,
  'refund payment records the returned amount'
);
select is(
  (
    select reference_number
    from public.refund_payments
    where refund_id = (select refund_id from refund_test_result where label = 'partial')
  ),
  'CARD-REFUND-1',
  'refund payment preserves its reference'
);
select is(
  (
    select status
    from public.sales
    where id = (select sale_id from refund_test_context where label = 'refund')
  ),
  'completed',
  'the original sale remains immutable and completed after a refund'
);
select is(
  (
    select has_refundable_quantity
    from public.get_pos_receipt_history(
      (select organization_id from refund_test_context where label = 'refund'),
      null,
      null,
      25
    )
    where sale_id = (select sale_id from refund_test_context where label = 'refund')
  ),
  true,
  'POS receipt history keeps a partially refunded receipt refundable from remaining item quantities'
);

select ok(
  (
    select was_replayed
    from public.refund_sale(
      (select organization_id from refund_test_context where label = 'refund'),
      (select sale_id from refund_test_context where label = 'refund'),
      (
        select id
        from public.payment_methods
        where organization_id = (select organization_id from refund_test_context where label = 'refund')
          and code = 'CARD'
      ),
      '45454545-4545-4454-8454-454545454545',
      'Customer returned one item',
      'CARD-REFUND-1',
      jsonb_build_array(jsonb_build_object(
        'sale_item_id', (
          select id
          from public.sale_items
          where sale_id = (select sale_id from refund_test_context where label = 'refund')
            and product_id = (select tracked_product_id from refund_test_context where label = 'refund')
        ),
        'quantity', 1
      ))
    )
  ),
  'replaying the same refund key returns the original refund'
);
select is(
  (
    select count(*)
    from public.refunds
    where sale_id = (select sale_id from refund_test_context where label = 'refund')
  ),
  1::bigint,
  'refund replay does not create another refund record'
);

insert into refund_test_result
select 'remaining', refund.*
from public.refund_sale(
  (select organization_id from refund_test_context where label = 'refund'),
  (select sale_id from refund_test_context where label = 'refund'),
  (
    select id
    from public.payment_methods
    where organization_id = (select organization_id from refund_test_context where label = 'refund')
      and code = 'CASH'
  ),
  '46464646-4646-4464-8464-464646464646',
  'Customer returned the remaining items',
  null,
  jsonb_build_array(
    jsonb_build_object(
      'sale_item_id', (
        select id
        from public.sale_items
        where sale_id = (select sale_id from refund_test_context where label = 'refund')
          and product_id = (select tracked_product_id from refund_test_context where label = 'refund')
      ),
      'quantity', 1
    ),
    jsonb_build_object(
      'sale_item_id', (
        select id
        from public.sale_items
        where sale_id = (select sale_id from refund_test_context where label = 'refund')
          and product_id = (select untracked_product_id from refund_test_context where label = 'refund')
      ),
      'quantity', 1
    )
  )
) refund;

select is(
  (select total_minor from refund_test_result where label = 'remaining'),
  1500::bigint,
  'a second refund can return the remaining sale quantities'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id = (select organization_id from refund_test_context where label = 'refund')
      and store_id = (select store_id from refund_test_context where label = 'refund')
      and product_id = (select tracked_product_id from refund_test_context where label = 'refund')
      and variant_id is null
  ),
  10.000::numeric,
  'all refunded tracked quantities restore original stock'
);
select is(
  (
    select count(*)
    from public.inventory_movements
    where source_type = 'refund'
      and movement_type = 'REFUND'
  ),
  2::bigint,
  'untracked refund lines do not create inventory movements'
);
select is(
  (
    select has_refundable_quantity
    from public.get_pos_receipt_history(
      (select organization_id from refund_test_context where label = 'refund'),
      null,
      null,
      25
    )
    where sale_id = (select sale_id from refund_test_context where label = 'refund')
  ),
  false,
  'POS receipt history marks a fully returned receipt as having no refundable quantity'
);

create or replace function pg_temp.excess_refund_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.refund_sale(
    (select organization_id from refund_test_context where label = 'refund'),
    (select sale_id from refund_test_context where label = 'refund'),
    (
      select id
      from public.payment_methods
      where organization_id = (select organization_id from refund_test_context where label = 'refund')
        and code = 'CASH'
    ),
    '47474747-4747-4474-8474-474747474747',
    'Attempt to exceed sold quantity',
    null,
    jsonb_build_array(jsonb_build_object(
      'sale_item_id', (
        select id
        from public.sale_items
        where sale_id = (select sale_id from refund_test_context where label = 'refund')
          and product_id = (select tracked_product_id from refund_test_context where label = 'refund')
      ),
      'quantity', 1
    ))
  );
  return false;
exception
  when check_violation then
    return true;
end;
$$;

select ok(pg_temp.excess_refund_is_rejected(), 'refund quantities cannot exceed the original sale');

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '42424242-4242-4424-8424-424242424242', 'REFUND-CASH-001', 'Cashier'
from refund_test_context
where label = 'refund';

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = '42424242-4242-4424-8424-424242424242';

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join refund_test_context context
  on context.organization_id = employee.organization_id
 and context.label = 'refund'
where employee.profile_id = '42424242-4242-4424-8424-424242424242';

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '42424242-4242-4424-8424-424242424242';

select is(
  (
    select count(*)
    from public.refunds
    where sale_id = (select sale_id from refund_test_context where label = 'refund')
  ),
  2::bigint,
  'receipt-authorized cashiers can view existing refund history'
);

create or replace function pg_temp.cashier_refund_is_rejected()
returns boolean
language plpgsql
as $$
begin
  perform public.refund_sale(
    (select organization_id from refund_test_context where label = 'refund'),
    (select sale_id from refund_test_context where label = 'refund'),
    (
      select id
      from public.payment_methods
      where organization_id = (select organization_id from refund_test_context where label = 'refund')
        and code = 'CASH'
    ),
    '48484848-4848-4484-8484-484848484848',
    'Cashier should not be able to refund',
    null,
    jsonb_build_array(jsonb_build_object(
      'sale_item_id', (
        select id
        from public.sale_items
        where sale_id = (select sale_id from refund_test_context where label = 'refund')
        limit 1
      ),
      'quantity', 1
    ))
  );
  return false;
exception
  when insufficient_privilege then
    return true;
end;
$$;

select ok(pg_temp.cashier_refund_is_rejected(), 'cashiers without sales.refund cannot process refunds');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '43434343-4343-4434-8434-434343434343';

select is(
  (
    select count(*)
    from public.refunds
    where organization_id = (select organization_id from refund_test_context where label = 'refund')
  ),
  0::bigint,
  'another organization cannot read refund history'
);

select * from finish();
rollback;
