begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

select has_column('public', 'inventory_adjustments', 'operation_id', 'adjustment documents retain a stable operation identity');
select has_column('public', 'inventory_adjustments', 'import_batch_id', 'CSV adjustment documents retain their import-batch identity');
select has_table('public', 'inventory_adjustment_import_batches', 'adjustment imports have an immutable batch header');
select has_function('public', 'record_inventory_adjustment', array['uuid', 'uuid', 'uuid', 'uuid', 'numeric', 'text', 'text', 'uuid', 'uuid'], 'the public controlled-adjustment command is present');
select ok(
  has_function_privilege('authenticated', 'public.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid)'::regprocedure, 'execute'),
  'authenticated callers may reach the canonical command, which performs its own authorization'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text)'::regprocedure, 'execute'),
  'the legacy V2 adjustment command is not executable by normal users'
);
select ok(
  not has_function_privilege('authenticated', 'private.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text)'::regprocedure, 'execute'),
  'the legacy private V2 adjustment command is not executable by normal users'
);
select ok(
  pg_get_functiondef('private.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid)'::regprocedure) like '%private.authorize_sensitive_operation%',
  'the canonical command uses the shared approval-aware authorization boundary'
);
select ok(
  pg_get_functiondef('private.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid)'::regprocedure) like '%private.inventory_actor%',
  'the canonical command uses the shared store-scope actor boundary'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('95000000-0000-4000-8000-000000000001', 'adjustment-owner@tindio.test', '{"full_name":"Adjustment Owner"}'::jsonb),
  ('95000000-0000-4000-8000-000000000002', 'adjustment-operator@tindio.test', '{"full_name":"Adjustment Operator"}'::jsonb),
  ('95000000-0000-4000-8000-000000000003', 'adjustment-viewer@tindio.test', '{"full_name":"Adjustment Viewer"}'::jsonb);

create temporary table controlled_adjustment_context (
  organization_id uuid not null,
  store_id uuid not null,
  owner_employee_id uuid,
  operator_employee_id uuid,
  viewer_employee_id uuid,
  product_id uuid,
  operation_id uuid default gen_random_uuid(),
  import_operation_id uuid default gen_random_uuid()
);

grant select, insert, update on table controlled_adjustment_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '95000000-0000-4000-8000-000000000001';

insert into controlled_adjustment_context (organization_id, store_id)
select setup.organization_id, setup.store_id
from public.bootstrap_organization('Controlled Adjustments Test', 'Controlled Adjustments Store', 'Controlled Adjustments Register') setup;

reset role;

update controlled_adjustment_context context
set owner_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = '95000000-0000-4000-8000-000000000001';

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '95000000-0000-4000-8000-000000000002', 'ADJUST-OP-001', 'Inventory adjustment operator'
from controlled_adjustment_context;

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '95000000-0000-4000-8000-000000000003', 'ADJUST-VIEW-001', 'Inventory adjustment viewer'
from controlled_adjustment_context;

update controlled_adjustment_context context
set operator_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = '95000000-0000-4000-8000-000000000002';

update controlled_adjustment_context context
set viewer_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = '95000000-0000-4000-8000-000000000003';

insert into public.roles (organization_id, name, code, is_system)
select organization_id, 'Adjustment operator', 'adjustment_operator', false
from controlled_adjustment_context
union all
select organization_id, 'Adjustment viewer', 'adjustment_viewer', false
from controlled_adjustment_context;

insert into public.role_permissions (organization_id, role_id, permission_code)
select context.organization_id, role.id, 'inventory.adjust'
from controlled_adjustment_context context
join public.roles role on role.organization_id = context.organization_id and role.code = 'adjustment_operator'
union all
select context.organization_id, role.id, 'inventory.view'
from controlled_adjustment_context context
join public.roles role on role.organization_id = context.organization_id and role.code = 'adjustment_viewer';

insert into public.employee_roles (organization_id, employee_id, role_id)
select context.organization_id, context.operator_employee_id, role.id
from controlled_adjustment_context context
join public.roles role on role.organization_id = context.organization_id and role.code = 'adjustment_operator'
union all
select context.organization_id, context.viewer_employee_id, role.id
from controlled_adjustment_context context
join public.roles role on role.organization_id = context.organization_id and role.code = 'adjustment_viewer';

insert into public.employee_stores (organization_id, employee_id, store_id)
select organization_id, operator_employee_id, store_id from controlled_adjustment_context
union all
select organization_id, viewer_employee_id, store_id from controlled_adjustment_context;

insert into public.inventory_adjustment_reasons (organization_id, code, name, movement_type, is_active)
select organization_id, 'PHASE5_DAMAGE', 'Phase 5 damage', 'DAMAGE', true
from controlled_adjustment_context;

set local role authenticated;
set local request.jwt.claim.sub = '95000000-0000-4000-8000-000000000001';

update controlled_adjustment_context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Controlled adjustment item',
  'A tracked item for adjustment authorization and idempotency tests.',
  'simple',
  'CONTROLLED-ADJUSTMENT-ITEM',
  '4800000009501',
  2500,
  1000,
  true,
  'each',
  array[store_id],
  '[]'::jsonb
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = '95000000-0000-4000-8000-000000000002';

select lives_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, 7, 'PHASE5_DAMAGE', 'Damaged in the stock room.', %L, null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context),
    (select operation_id from controlled_adjustment_context)
  ),
  'a custom role with only inventory.adjust and the assigned store can post a controlled adjustment'
);
select is(
  (select count(*) from public.inventory_adjustments adjustment join controlled_adjustment_context context on context.organization_id = adjustment.organization_id where adjustment.operation_id = context.operation_id),
  1::bigint,
  'the first operation creates exactly one immutable adjustment header'
);
select is(
  (select quantity_before from public.inventory_movements movement join public.inventory_adjustments adjustment on adjustment.id = movement.source_id join controlled_adjustment_context context on context.operation_id = adjustment.operation_id where movement.source_type = 'inventory_adjustment'),
  0::numeric,
  'the ledger records the authoritative quantity before the adjustment'
);
select is(
  (select quantity_after from public.inventory_movements movement join public.inventory_adjustments adjustment on adjustment.id = movement.source_id join controlled_adjustment_context context on context.operation_id = adjustment.operation_id where movement.source_type = 'inventory_adjustment'),
  7::numeric,
  'the ledger records the authoritative quantity after the adjustment'
);
select lives_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, 7, 'PHASE5_DAMAGE', 'Damaged in the stock room.', %L, null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context),
    (select operation_id from controlled_adjustment_context)
  ),
  'an exact retry of the same operation is idempotent'
);
select is(
  (select count(*) from public.inventory_adjustments adjustment join controlled_adjustment_context context on context.organization_id = adjustment.organization_id where adjustment.operation_id = context.operation_id),
  1::bigint,
  'an exact retry does not duplicate the adjustment header'
);
select throws_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, 8, 'PHASE5_DAMAGE', 'Damaged in the stock room.', %L, null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context),
    (select operation_id from controlled_adjustment_context)
  ),
  '23505',
  'This adjustment operation identity was already used for different details.',
  'an operation identity cannot be reused for different adjustment details'
);
select throws_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, 1, 'PHASE5_DAMAGE', 'x', gen_random_uuid(), null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context)
  ),
  '23514',
  'Provide an adjustment explanation between 2 and 500 characters.',
  'an adjustment requires a clear explanation'
);
select is(
  (select count(*) from public.inventory_adjustments adjustment join controlled_adjustment_context context on context.organization_id = adjustment.organization_id),
  1::bigint,
  'failed validation does not create an adjustment document'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '95000000-0000-4000-8000-000000000003';

select throws_ok(
  format(
    $$select public.record_inventory_adjustment(%L, %L, %L, null, 1, 'PHASE5_DAMAGE', 'Viewer must not adjust stock.', gen_random_uuid(), null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context)
  ),
  '42501',
  'Permission is required for this operation.',
  'a store-assigned viewer without inventory.adjust cannot post an adjustment'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '95000000-0000-4000-8000-000000000002';

select lives_ok(
  format(
    $$select public.import_inventory_adjustments_csv(%L, %L, 'PHASE5_DAMAGE', jsonb_build_array(jsonb_build_object('row_number', 2, 'product_id', %L::uuid, 'variant_id', null, 'quantity_delta', -2, 'note', 'Two units were damaged during receiving.')), %L, null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context),
    (select import_operation_id from controlled_adjustment_context)
  ),
  'a custom adjuster can post an explained CSV adjustment batch'
);
select lives_ok(
  format(
    $$select public.import_inventory_adjustments_csv(%L, %L, 'PHASE5_DAMAGE', jsonb_build_array(jsonb_build_object('row_number', 2, 'product_id', %L::uuid, 'variant_id', null, 'quantity_delta', -2, 'note', 'Two units were damaged during receiving.')), %L, null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context),
    (select import_operation_id from controlled_adjustment_context)
  ),
  'an exact CSV retry is idempotent'
);
select is(
  (select count(*) from public.inventory_adjustment_import_batches batch join controlled_adjustment_context context on context.organization_id = batch.organization_id where batch.operation_id = context.import_operation_id),
  1::bigint,
  'the CSV import has exactly one immutable batch header'
);
select is(
  (select count(*) from public.inventory_adjustments adjustment join controlled_adjustment_context context on context.organization_id = adjustment.organization_id where adjustment.import_batch_id is not null),
  1::bigint,
  'the CSV import creates exactly one linked adjustment document'
);
select throws_ok(
  format(
    $$select public.import_inventory_adjustments_csv(%L, %L, 'PHASE5_DAMAGE', jsonb_build_array(jsonb_build_object('row_number', 2, 'product_id', %L::uuid, 'variant_id', null, 'quantity_delta', -3, 'note', 'Different data must not replay.')), %L, null)$$,
    (select organization_id from controlled_adjustment_context),
    (select store_id from controlled_adjustment_context),
    (select product_id from controlled_adjustment_context),
    (select import_operation_id from controlled_adjustment_context)
  ),
  '23505',
  'This adjustment import operation identity was already used for different details.',
  'a CSV batch identity cannot be reused for different row details'
);
select is(
  (select quantity from public.inventory_levels level join controlled_adjustment_context context on context.organization_id = level.organization_id and context.store_id = level.store_id and context.product_id = level.product_id),
  5::numeric,
  'the authoritative projection changes only by the two successful ledger operations'
);
select ok(
  exists (
    select 1 from public.audit_logs audit join controlled_adjustment_context context on context.organization_id = audit.organization_id
    where audit.event_type = 'INVENTORY_ADJUSTMENTS_IMPORTED'
      and audit.details ->> 'operation_id' = context.import_operation_id::text
  ),
  'the CSV import writes an immutable audit record with the operation identity'
);

select * from finish();
rollback;
