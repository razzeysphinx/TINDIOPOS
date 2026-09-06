begin;

create extension if not exists pgtap with schema extensions;
select plan(31);

select has_column('public', 'inventory_count_lines', 'reconciled_expected_quantity', 'count lines retain the reconciled expected projection');
select has_column('public', 'inventory_count_lines', 'counted_at', 'count lines record when the physical quantity was saved');
select ok(
  pg_get_functiondef('private.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric)'::regprocedure) like '%private.inventory_count_actor%',
  'saving a count line uses the shared capability and store-scope boundary'
);
select ok(
  pg_get_functiondef('private.post_inventory_count(uuid,uuid)'::regprocedure) like '%reconciled_expected_quantity%',
  'posting a count uses the reconciled expected quantity rather than the stale snapshot'
);
select ok(
  not has_function_privilege('anon', 'public.save_inventory_count_line(uuid,uuid,uuid,uuid,numeric)', 'execute'),
  'anonymous callers cannot save count lines'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('94000000-0000-4000-8000-000000000001', 'count-reconciliation-owner@tindio.test', '{"full_name":"Count Reconciliation Owner"}'::jsonb),
  ('94000000-0000-4000-8000-000000000002', 'count-reconciliation-counter@tindio.test', '{"full_name":"Count Only Employee"}'::jsonb);

create temporary table count_reconciliation_context (
  organization_id uuid not null,
  store_id uuid not null,
  owner_employee_id uuid,
  counter_employee_id uuid,
  product_id uuid,
  category_id uuid,
  count_id uuid,
  blind_count_id uuid,
  category_count_id uuid
);

grant select, insert, update on table count_reconciliation_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000001';

insert into count_reconciliation_context (organization_id, store_id)
select setup.organization_id, setup.store_id
from public.bootstrap_organization('Count Reconciliation Test', 'Count Reconciliation Main', 'Count Reconciliation Register') setup;

reset role;

update count_reconciliation_context context
set owner_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = '94000000-0000-4000-8000-000000000001';

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '94000000-0000-4000-8000-000000000002', 'COUNT-ONLY-001', 'Count-only employee'
from count_reconciliation_context;

update count_reconciliation_context context
set counter_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = '94000000-0000-4000-8000-000000000002';

insert into public.roles (organization_id, name, code, is_system)
select organization_id, 'Count only', 'count_only', false
from count_reconciliation_context;

insert into public.role_permissions (organization_id, role_id, permission_code)
select context.organization_id, role.id, 'inventory.count'
from count_reconciliation_context context
join public.roles role
  on role.organization_id = context.organization_id
 and role.code = 'count_only';

insert into public.employee_roles (organization_id, employee_id, role_id)
select context.organization_id, context.counter_employee_id, role.id
from count_reconciliation_context context
join public.roles role
  on role.organization_id = context.organization_id
 and role.code = 'count_only';

insert into public.employee_stores (organization_id, employee_id, store_id)
select organization_id, counter_employee_id, store_id
from count_reconciliation_context;

insert into public.categories (organization_id, name)
select organization_id, 'Cycle count category'
from count_reconciliation_context;

update count_reconciliation_context context
set category_id = category.id
from public.categories category
where category.organization_id = context.organization_id
  and category.name = 'Cycle count category';

set local role authenticated;
set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000001';

update count_reconciliation_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Count reconciliation item',
  'A tracked item used to verify concurrent count reconciliation.',
  'simple',
  'COUNT-RECON-ITEM',
  '4800000009402',
  2500,
  1000,
  true,
  'each',
  array[store_id],
  '[]'::jsonb
);

reset role;

update public.products product
set category_id = context.category_id
from count_reconciliation_context context
where product.id = context.product_id
  and product.organization_id = context.organization_id;

select private.apply_inventory_change_v2(
  context.organization_id, context.store_id, context.product_id, null,
  50, 'ADJUSTMENT', context.owner_employee_id, 'Opening count reconciliation fixture',
  'test_fixture', gen_random_uuid(), 1000, 'FIXTURE'
)
from count_reconciliation_context context;

select is(
  (select quantity from public.inventory_levels level join count_reconciliation_context context on context.organization_id = level.organization_id and context.store_id = level.store_id and context.product_id = level.product_id),
  50::numeric,
  'the count-start projection is fifty'
);

set local role authenticated;
set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000002';

update count_reconciliation_context
set count_id = public.create_inventory_count_plan(
  organization_id, store_id, 'Concurrent standard count', 'standard', 'selected', null,
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null)),
  'product_name', true
);

select ok((select count_id is not null from count_reconciliation_context), 'a count-only employee can prepare a selected-item count');
select is(
  (select expected_quantity from public.inventory_count_lines line join count_reconciliation_context context on context.count_id = line.inventory_count_id),
  50::numeric,
  'the prepared line preserves its count-start snapshot'
);

reset role;

select private.apply_inventory_change_v2(context.organization_id, context.store_id, context.product_id, null, -4, 'SALE', context.owner_employee_id, 'Sale during physical count', 'test_sale', gen_random_uuid(), null, 'TEST_SALE') from count_reconciliation_context context;
select private.apply_inventory_change_v2(context.organization_id, context.store_id, context.product_id, null, 8, 'RECEIPT', context.owner_employee_id, 'Receipt during physical count', 'test_receipt', gen_random_uuid(), 1000, 'TEST_RECEIPT') from count_reconciliation_context context;
select private.apply_inventory_change_v2(context.organization_id, context.store_id, context.product_id, null, -3, 'TRANSFER_OUT', context.owner_employee_id, 'Transfer during physical count', 'test_transfer', gen_random_uuid(), null, 'TEST_TRANSFER') from count_reconciliation_context context;

set local role authenticated;
set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000002';

select lives_ok(
  format(
    $$select public.save_inventory_count_line(%L, %L, %L, null, 51)$$,
    (select organization_id from count_reconciliation_context),
    (select count_id from count_reconciliation_context),
    (select product_id from count_reconciliation_context)
  ),
  'a count-only employee can save the physical quantity'
);
select is(
  (select expected_quantity from public.inventory_count_lines line join count_reconciliation_context context on context.count_id = line.inventory_count_id),
  50::numeric,
  'saving a physical count does not rewrite the count-start snapshot'
);
select is(
  (select reconciled_expected_quantity from public.inventory_count_lines line join count_reconciliation_context context on context.count_id = line.inventory_count_id),
  51::numeric,
  'the saved line reconciles sales, receiving, and transfer movement during the count'
);
select is(
  (select counted_quantity from public.inventory_count_lines line join count_reconciliation_context context on context.count_id = line.inventory_count_id),
  51::numeric,
  'the physical quantity is retained separately from both expected quantities'
);
select ok(
  (select counted_at is not null from public.inventory_count_lines line join count_reconciliation_context context on context.count_id = line.inventory_count_id),
  'the reconciliation point is timestamped'
);

reset role;

select private.apply_inventory_change_v2(context.organization_id, context.store_id, context.product_id, null, 3, 'RECEIPT', context.owner_employee_id, 'Receipt after physical count', 'test_receipt', gen_random_uuid(), 1000, 'TEST_RECEIPT') from count_reconciliation_context context;

set local role authenticated;
set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000002';

select lives_ok(
  format($$select public.submit_inventory_count_for_review(%L, %L)$$, (select organization_id from count_reconciliation_context), (select count_id from count_reconciliation_context)),
  'the reconciled count can be submitted for review'
);
select lives_ok(
  format($$select public.post_inventory_count(%L, %L)$$, (select organization_id from count_reconciliation_context), (select count_id from count_reconciliation_context)),
  'the reviewed count can be posted'
);
select is(
  (select quantity from public.inventory_levels level join count_reconciliation_context context on context.organization_id = level.organization_id and context.store_id = level.store_id and context.product_id = level.product_id),
  54::numeric,
  'a zero count variance preserves movements that occurred after the physical count'
);
select is(
  (select count(*) from public.inventory_movements movement join count_reconciliation_context context on context.count_id = movement.source_id where movement.movement_type = 'COUNT'),
  0::bigint,
  'no compensating count movement is posted when the reconciled variance is zero'
);
select is(
  (select status from public.inventory_counts count_document join count_reconciliation_context context on context.count_id = count_document.id),
  'posted',
  'the count is marked posted exactly once'
);
select throws_ok(
  format($$select public.post_inventory_count(%L, %L)$$, (select organization_id from count_reconciliation_context), (select count_id from count_reconciliation_context)),
  '23514',
  'Only a reviewed inventory count can be posted.',
  'a duplicate count post is rejected'
);

update count_reconciliation_context
set blind_count_id = public.create_inventory_count_plan(
  organization_id, store_id, 'Blind full-store count', 'blind', 'full_store', null,
  '[]'::jsonb, 'sku', true
);
select is(
  (select count_mode from public.inventory_counts count_document join count_reconciliation_context context on context.blind_count_id = count_document.id),
  'blind',
  'blind count mode remains persisted in the count document'
);
select is(
  (select scope_type from public.inventory_counts count_document join count_reconciliation_context context on context.blind_count_id = count_document.id),
  'full_store',
  'full-store count scope remains persisted in the count document'
);
select is(
  (select expected_quantity from public.inventory_count_lines line join count_reconciliation_context context on context.blind_count_id = line.inventory_count_id),
  54::numeric,
  'blind count preparation snapshots the current stock without changing it'
);

update count_reconciliation_context
set category_count_id = public.create_inventory_count_plan(
  organization_id, store_id, 'Category cycle count', 'standard', 'category', category_id,
  '[]'::jsonb, 'category_name', true
);
select is(
  (select count(*) from public.inventory_count_lines line join count_reconciliation_context context on context.category_count_id = line.inventory_count_id),
  1::bigint,
  'category count scope prepares only the matching tracked item'
);
select is(
  (select scope_type from public.inventory_counts count_document join count_reconciliation_context context on context.category_count_id = count_document.id),
  'category',
  'category count scope remains persisted in the count document'
);
select is(
  (select expected_quantity from public.inventory_count_lines line join count_reconciliation_context context on context.category_count_id = line.inventory_count_id),
  54::numeric,
  'category count preparation preserves the current stock snapshot'
);

reset role;

select private.apply_inventory_change_v2(context.organization_id, context.store_id, context.product_id, null, -1, 'SALE', context.owner_employee_id, 'Sale during variance count', 'test_sale', gen_random_uuid(), null, 'TEST_SALE') from count_reconciliation_context context;

set local role authenticated;
set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000002';

select lives_ok(
  format($$select public.save_inventory_count_line(%L, %L, %L, null, 52)$$, (select organization_id from count_reconciliation_context), (select category_count_id from count_reconciliation_context), (select product_id from count_reconciliation_context)),
  'a category count saves a physical shortage against the reconciled projection'
);
select is(
  (select reconciled_expected_quantity from public.inventory_count_lines line join count_reconciliation_context context on context.category_count_id = line.inventory_count_id),
  53::numeric,
  'the later count records the stock projection after its in-progress sale'
);

reset role;

select private.apply_inventory_change_v2(context.organization_id, context.store_id, context.product_id, null, 3, 'RECEIPT', context.owner_employee_id, 'Receipt after variance count', 'test_receipt', gen_random_uuid(), 1000, 'TEST_RECEIPT') from count_reconciliation_context context;

set local role authenticated;
set local request.jwt.claim.sub = '94000000-0000-4000-8000-000000000002';

select lives_ok(
  format($$select public.submit_inventory_count_for_review(%L, %L)$$, (select organization_id from count_reconciliation_context), (select category_count_id from count_reconciliation_context)),
  'the non-zero count variance can be reviewed'
);
select lives_ok(
  format($$select public.post_inventory_count(%L, %L)$$, (select organization_id from count_reconciliation_context), (select category_count_id from count_reconciliation_context)),
  'the non-zero count variance can be posted'
);
select is(
  (select quantity from public.inventory_levels level join count_reconciliation_context context on context.organization_id = level.organization_id and context.store_id = level.store_id and context.product_id = level.product_id),
  55::numeric,
  'the recorded shortage applies once while the later receipt remains intact'
);

reset role;

select is(
  (select quantity_delta from public.inventory_movements movement join count_reconciliation_context context on context.category_count_id = movement.source_id where movement.movement_type = 'COUNT'),
  (-1)::numeric,
  'the count ledger records only the measured reconciled variance'
);

select * from finish();
rollback;
