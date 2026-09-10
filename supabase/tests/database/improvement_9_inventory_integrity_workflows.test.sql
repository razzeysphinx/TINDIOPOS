begin;

create extension if not exists pgtap with schema extensions;

select plan(57);

select has_table('public', 'inventory_policies', 'inventory policies table exists');
select has_table('public', 'inventory_adjustment_reasons', 'inventory adjustment reasons table exists');
select has_table('public', 'stock_transfer_receipts', 'stock transfer receipts table exists');
select has_table('public', 'stock_transfer_receipt_lines', 'stock transfer receipt lines table exists');
select has_table('public', 'supplier_returns', 'supplier returns table exists');
select has_table('public', 'supplier_return_lines', 'supplier return lines table exists');
select has_table('public', 'production_runs', 'production runs table exists');
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('inventory_policies', 'inventory_adjustment_reasons', 'stock_transfer_receipts', 'stock_transfer_receipt_lines', 'supplier_returns', 'supplier_return_lines', 'production_runs')
      and relation.relrowsecurity
  ),
  7::bigint,
  'RLS is enabled on every new inventory-integrity table'
);
select ok(
  pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conname = 'inventory_movements_type_values' and conrelid = 'public.inventory_movements'::regclass)) like '%SUPPLIER_RETURN%'
  and pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conname = 'inventory_movements_type_values' and conrelid = 'public.inventory_movements'::regclass)) like '%PRODUCTION%'
  and pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conname = 'inventory_movements_type_values' and conrelid = 'public.inventory_movements'::regclass)) like '%DAMAGE%',
  'ledger accepts the new accountable movement types'
);
select has_column('public', 'inventory_levels', 'average_cost_minor', 'inventory levels retain weighted average cost');
select has_column('public', 'inventory_movements', 'unit_cost_minor', 'ledger retains a unit-cost snapshot');
select has_column('public', 'sale_items', 'cogs_minor', 'sale items retain immutable COGS');
select ok(to_regprocedure('public.update_inventory_policy(uuid,uuid,text)') is not null, 'negative-stock policy routine exists');
select ok(to_regprocedure('public.create_inventory_adjustment_reason(uuid,text,text,text)') is not null, 'adjustment reason routine exists');
select ok(to_regprocedure('public.record_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid)') is not null, 'controlled adjustment routine exists');
select ok(to_regprocedure('public.ship_stock_transfer(uuid,uuid,uuid,jsonb,text)') is not null, 'legacy immediate-shipment routine is retained for migration compatibility');
select ok(to_regprocedure('public.receive_stock_transfer(uuid,uuid,jsonb,text,uuid)') is not null, 'idempotent legacy transfer-receipt routine exists');
select ok(to_regprocedure('public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)') is not null, 'idempotent supplier return routine exists');
select ok(to_regprocedure('public.produce_composite(uuid,uuid,uuid,numeric,text,uuid)') is not null, 'idempotent composite production routine exists');
select ok(to_regprocedure('public.get_inventory_valuation(uuid)') is not null, 'inventory valuation routine exists');
select ok(not has_function_privilege('anon', 'public.ship_stock_transfer(uuid,uuid,uuid,jsonb,text)', 'execute'), 'anonymous callers cannot ship transfers');
select ok(not has_function_privilege('authenticated', 'public.ship_stock_transfer(uuid,uuid,uuid,jsonb,text)', 'execute'), 'authenticated callers cannot bypass request approval with immediate shipment');
select ok(not has_function_privilege('authenticated', 'public.return_to_supplier(uuid,uuid,uuid,jsonb,text)', 'execute'), 'authenticated callers cannot post supplier returns through the non-idempotent legacy overload');
select ok(not has_function_privilege('authenticated', 'public.produce_composite(uuid,uuid,uuid,numeric,text)', 'execute'), 'authenticated callers cannot post production through the non-idempotent legacy overload');
select ok(not has_table_privilege('authenticated', 'public.inventory_policies', 'insert'), 'authenticated callers cannot insert stock policies directly');
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'supplier_returns'
      and policyname = 'supplier_returns_select_authorized_scope'
      and qual like '%has_store_read_scope%'
  ),
  'supplier-return headers apply the central store read scope'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'supplier_return_lines'
      and policyname = 'supplier_return_lines_select_authorized_scope'
      and qual like '%has_store_read_scope%'
  ),
  'supplier-return lines inherit the originating store scope'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'production_runs'
      and policyname = 'production_runs_select_authorized_scope'
      and qual like '%has_store_read_scope%'
  ),
  'production runs apply the central store read scope'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('92929292-9292-4929-8929-929292929292', 'integrity-owner@tindio.test', '{"full_name":"Inventory Integrity Owner"}'::jsonb);

create temporary table inventory_integrity_context (
  organization_id uuid not null,
  store_id uuid not null,
  destination_store_id uuid,
  register_id uuid not null,
  product_id uuid,
  supplier_id uuid,
  transfer_id uuid,
  transfer_line_id uuid,
  component_product_id uuid,
  composite_product_id uuid,
  supplier_return_operation_id uuid default gen_random_uuid(),
  production_operation_id uuid default gen_random_uuid()
);
grant select, insert, update on inventory_integrity_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '92929292-9292-4929-8929-929292929292';

insert into inventory_integrity_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Inventory Integrity Retail', 'Integrity Main', 'Integrity Counter');

with destination_store as (
  insert into public.stores (organization_id, name, code)
  values ((select organization_id from inventory_integrity_context), 'Integrity Branch', 'INTEGRITY-BRANCH')
  returning id
)
update inventory_integrity_context
set destination_store_id = destination_store.id
from destination_store;

insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.destination_store_id
from inventory_integrity_context context
join public.employees employee on employee.organization_id = context.organization_id
where employee.profile_id = auth.uid();

update inventory_integrity_context
set product_id = public.create_catalog_product(
  organization_id, null, 'Integrity Stock Item', 'Inventory integrity test item', 'simple', 'INTEGRITY-ITEM', '480000099001', 2500, 1000, true, 'each', array[store_id, destination_store_id], '[]'::jsonb
);

update inventory_integrity_context
set supplier_id = public.create_supplier(organization_id, 'Integrity Supplier', '', '', '', '', '');

select public.create_inventory_adjustment_reason(
  (select organization_id from inventory_integrity_context), 'DAMAGE', 'Damaged goods', 'DAMAGE'
);
select is((select count(*) from public.inventory_adjustment_reasons), 1::bigint, 'controlled adjustment reason is recorded');

-- Receive 10 stock units at PHP 10.00 cost to establish both quantity and valuation.
create temporary table integrity_purchase_context (purchase_order_id uuid, purchase_order_line_id uuid);
grant select, insert, update on integrity_purchase_context to authenticated;
insert into integrity_purchase_context (purchase_order_id)
select public.create_purchase_order(
  context.organization_id, context.store_id, context.supplier_id, 'Integrity delivery', null,
  jsonb_build_array(jsonb_build_object('product_id', context.product_id, 'variant_id', null, 'purchase_unit_code', 'each', 'quantity', '10', 'unit_cost_minor', 1000)),
  gen_random_uuid()
)
from inventory_integrity_context context;
update integrity_purchase_context
set purchase_order_line_id = (select id from public.purchase_order_lines where purchase_order_id = integrity_purchase_context.purchase_order_id);
select lives_ok(
  format(
    $$select public.receive_purchase_order(%L, %L, %L::jsonb, 'Received', gen_random_uuid())$$,
    (select organization_id from inventory_integrity_context),
    (select purchase_order_id from integrity_purchase_context),
    jsonb_build_array(jsonb_build_object('purchase_order_line_id', (select purchase_order_line_id from integrity_purchase_context), 'quantity', '10'))
  ),
  'receiving uses the cost-aware ledger routine'
);
select is(
  (
    select valuation.average_cost_minor
    from public.get_inventory_valuation((select organization_id from inventory_integrity_context)) valuation
    where valuation.store_id = (select store_id from inventory_integrity_context)
      and valuation.product_id = (select product_id from inventory_integrity_context)
  ),
  1000::bigint,
  'receipt establishes weighted average cost through the authorized valuation read path'
);

-- Historic transfers remain receivable during the migration period. The fixture
-- is created as the database owner because the legacy immediate-shipment RPC is
-- deliberately unavailable to application roles.
reset role;
with transfer_fixture as (
  insert into public.stock_transfers (
    organization_id, transfer_number, operation_id, source_store_id, destination_store_id,
    status, note, transferred_by_employee_id
  )
  select context.organization_id, nextval('private.tindio_stock_transfer_number_sequence'), gen_random_uuid(), context.store_id, context.destination_store_id,
    'in_transit', 'Historic transfer fixture', employee.id
  from inventory_integrity_context context
  join public.employees employee on employee.organization_id = context.organization_id and employee.profile_id = '92929292-9292-4929-8929-929292929292'
  returning id
)
update inventory_integrity_context
set transfer_id = transfer_fixture.id
from transfer_fixture;
insert into public.stock_transfer_lines (
  organization_id, stock_transfer_id, product_id, variant_id, quantity, unit_cost_minor
)
select context.organization_id, context.transfer_id, context.product_id, null, 4, 1000
from inventory_integrity_context context;
update inventory_integrity_context
set transfer_line_id = (select id from public.stock_transfer_lines where stock_transfer_id = inventory_integrity_context.transfer_id);
select private.apply_inventory_change_v2(
  (select organization_id from inventory_integrity_context),
  (select store_id from inventory_integrity_context),
  (select product_id from inventory_integrity_context),
  null,
  -4,
  'TRANSFER_OUT',
  (select id from public.employees where organization_id = (select organization_id from inventory_integrity_context) and profile_id = '92929292-9292-4929-8929-929292929292'),
  'Historic transfer fixture dispatched',
  'stock_transfer',
  (select transfer_id from inventory_integrity_context),
  1000
);
set local role authenticated;
set local request.jwt.claim.sub = '92929292-9292-4929-8929-929292929292';
select is((select status from public.stock_transfers where id = (select transfer_id from inventory_integrity_context)), 'in_transit', 'historic fixture remains an in-transit transfer');
select is((select quantity from public.inventory_levels where store_id = (select store_id from inventory_integrity_context) and product_id = (select product_id from inventory_integrity_context)), 6::numeric, 'historic transfer fixture reduces source stock through the ledger');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from inventory_integrity_context) and product_id = (select product_id from inventory_integrity_context)), 0::numeric, 'historic fixture does not increase destination stock yet');
select lives_ok(
  format(
    $$select public.receive_stock_transfer(%L, %L, %L::jsonb, 'Receive one', gen_random_uuid())$$,
    (select organization_id from inventory_integrity_context), (select transfer_id from inventory_integrity_context),
    jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from inventory_integrity_context), 'quantity', '1'))
  ),
  'partial transfer receipt succeeds'
);
select is((select status from public.stock_transfers where id = (select transfer_id from inventory_integrity_context)), 'partially_received', 'partial receipt retains the transfer state');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from inventory_integrity_context) and product_id = (select product_id from inventory_integrity_context)), 1::numeric, 'partial receipt increases only received destination stock');
select lives_ok(
  format(
    $$select public.receive_stock_transfer(%L, %L, %L::jsonb, 'Receive rest', gen_random_uuid())$$,
    (select organization_id from inventory_integrity_context), (select transfer_id from inventory_integrity_context),
    jsonb_build_array(jsonb_build_object('stock_transfer_line_id', (select transfer_line_id from inventory_integrity_context), 'quantity', '3'))
  ),
  'final transfer receipt succeeds'
);
select is((select status from public.stock_transfers where id = (select transfer_id from inventory_integrity_context)), 'completed', 'final receipt completes the transfer');
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from inventory_integrity_context) and product_id = (select product_id from inventory_integrity_context)), 4::numeric, 'all received stock is available at the destination');

select lives_ok(
  format(
    $$select public.return_to_supplier(%L, %L, %L, %L::jsonb, 'Return one', %L)$$,
    (select organization_id from inventory_integrity_context), (select destination_store_id from inventory_integrity_context), (select supplier_id from inventory_integrity_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from inventory_integrity_context), 'variant_id', null, 'quantity', '1')),
    (select supplier_return_operation_id from inventory_integrity_context)
  ),
  'supplier return succeeds'
);
select is(
  public.return_to_supplier(
    (select organization_id from inventory_integrity_context),
    (select destination_store_id from inventory_integrity_context),
    (select supplier_id from inventory_integrity_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from inventory_integrity_context), 'variant_id', null, 'quantity', '1')),
    'Return one',
    (select supplier_return_operation_id from inventory_integrity_context)
  ),
  (select id from public.supplier_returns where operation_id = (select supplier_return_operation_id from inventory_integrity_context)),
  'supplier return retry returns the original document'
);
select is((select quantity from public.inventory_levels where store_id = (select destination_store_id from inventory_integrity_context) and product_id = (select product_id from inventory_integrity_context)), 3::numeric, 'supplier return reduces destination stock');
select is((select movement_type from public.inventory_movements where source_type = 'supplier_return' order by created_at desc limit 1), 'SUPPLIER_RETURN', 'supplier return has an accountable ledger movement');

select public.update_inventory_policy((select organization_id from inventory_integrity_context), (select store_id from inventory_integrity_context), 'block');
select is((select negative_stock_policy from public.inventory_policies where store_id = (select store_id from inventory_integrity_context)), 'block', 'block policy is stored per store');
create or replace function pg_temp.blocked_negative_adjustment_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.record_inventory_adjustment(
    (select organization_id from inventory_integrity_context), (select store_id from inventory_integrity_context), (select product_id from inventory_integrity_context), null, -7, 'DAMAGE', 'Too much damage', gen_random_uuid(), null
  );
  return false;
exception when check_violation then
  return true;
end;
$$;
select ok(pg_temp.blocked_negative_adjustment_is_rejected(), 'block policy rejects a negative stock movement');
select public.update_inventory_policy((select organization_id from inventory_integrity_context), (select store_id from inventory_integrity_context), 'warn');
select lives_ok(
  $$select public.record_inventory_adjustment((select organization_id from inventory_integrity_context), (select store_id from inventory_integrity_context), (select product_id from inventory_integrity_context), null, -7, 'DAMAGE', 'Approved warning', gen_random_uuid(), null)$$,
  'warn policy permits an accountable negative movement'
);
select is((select quantity from public.inventory_levels where store_id = (select store_id from inventory_integrity_context) and product_id = (select product_id from inventory_integrity_context)), (-1)::numeric, 'warn policy permits the resulting negative projection');
select is(public.get_checkout_stock_warning((select organization_id from inventory_integrity_context), (select store_id from inventory_integrity_context)), 1, 'warn policy returns a limited post-checkout stock warning');

update inventory_integrity_context
set component_product_id = public.create_catalog_product(
  organization_id, null, 'Production Component', 'Component', 'simple', 'PRODUCTION-COMPONENT', '480000099002', 1500, 500, true, 'each', array[store_id], '[]'::jsonb
);
update inventory_integrity_context
set composite_product_id = public.create_catalog_product(
  organization_id, null, 'Produced Bundle', 'Composite output', 'simple', 'PRODUCED-BUNDLE', '480000099003', 3000, 0, true, 'each', array[store_id], '[]'::jsonb
);
update public.products set is_composite = true where id = (select composite_product_id from inventory_integrity_context);
insert into public.product_components (organization_id, product_id, component_product_id, component_variant_id, quantity_per_composite)
select organization_id, composite_product_id, component_product_id, null, 2 from inventory_integrity_context;
select lives_ok(
  $$select public.record_inventory_adjustment((select organization_id from inventory_integrity_context), (select store_id from inventory_integrity_context), (select component_product_id from inventory_integrity_context), null, 6, 'DAMAGE', 'Seed production component', gen_random_uuid(), null)$$,
  'controlled ledger adjustment seeds production components'
);
select lives_ok(
  $$select public.produce_composite((select organization_id from inventory_integrity_context), (select store_id from inventory_integrity_context), (select composite_product_id from inventory_integrity_context), 2, 'Make two bundles', (select production_operation_id from inventory_integrity_context))$$,
  'composite production succeeds through the existing composite-product bridge'
);
select is(
  public.produce_composite(
    (select organization_id from inventory_integrity_context),
    (select store_id from inventory_integrity_context),
    (select composite_product_id from inventory_integrity_context),
    2,
    'Make two bundles',
    (select production_operation_id from inventory_integrity_context)
  ),
  (select id from public.production_runs where operation_id = (select production_operation_id from inventory_integrity_context)),
  'production retry returns the original run'
);
select is((select quantity from public.inventory_levels where store_id = (select store_id from inventory_integrity_context) and product_id = (select component_product_id from inventory_integrity_context)), 2::numeric, 'production consumes the recipe component');
select is((select quantity from public.inventory_levels where store_id = (select store_id from inventory_integrity_context) and product_id = (select composite_product_id from inventory_integrity_context)), 2::numeric, 'production adds composite output stock');
select is(
  (
    select valuation.average_cost_minor
    from public.get_inventory_valuation((select organization_id from inventory_integrity_context)) valuation
    where valuation.store_id = (select store_id from inventory_integrity_context)
      and valuation.product_id = (select composite_product_id from inventory_integrity_context)
  ),
  1000::bigint,
  'production assigns output cost through the authorized valuation read path'
);
select is((select count(*) from public.production_runs), 1::bigint, 'production run is retained');
select is((select count(*) from public.get_inventory_valuation((select organization_id from inventory_integrity_context))), 4::bigint, 'valuation returns every initialized projection in the organization');

select * from finish();
rollback;
