begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

select has_column('public', 'products', 'composite_inventory_mode', 'products expose a composite inventory mode');
select has_table('public', 'production_run_components', 'production component snapshots exist');
select ok(to_regprocedure('public.create_catalog_product_v3(uuid,uuid,text,text,text,text,text,bigint,bigint,boolean,text,uuid[],jsonb,text,boolean,boolean,text)') is not null, 'catalog v3 creation route exists');
select ok(to_regprocedure('public.update_catalog_product_v3(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean,text)') is not null, 'catalog v3 update route exists');
select ok(to_regprocedure('public.produce_composite(uuid,uuid,uuid,numeric,text,uuid)') is not null, 'canonical production route exists');
select ok(to_regprocedure('public.produce_composite(uuid,uuid,uuid,numeric,text)') is null, 'non-idempotent public production overload is retired');
select ok(to_regprocedure('private.produce_composite(uuid,uuid,uuid,numeric,text,uuid)') is null, 'private production engine is retired');
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'production_run_components'
      and policyname = 'production_run_components_select_authorized_scope'
      and qual like '%has_store_read_scope%'
  ),
  'production component evidence inherits store read scope'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('93939393-9393-4939-8939-939393939393', 'phase12-owner@tindio.test', '{"full_name":"Phase 12 Owner"}'::jsonb);

create temporary table phase12_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  actor_employee_id uuid,
  component_product_id uuid,
  made_to_order_product_id uuid,
  stocked_product_id uuid,
  production_operation_id uuid default gen_random_uuid(),
  production_run_id uuid
);
grant select, insert, update on phase12_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '93939393-9393-4939-8939-939393939393';

insert into phase12_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Phase 12 Production', 'Production Store', 'Production Register');

update phase12_context
set actor_employee_id = (
  select employee.id
  from public.employees employee
  where employee.organization_id = phase12_context.organization_id
    and employee.profile_id = '93939393-9393-4939-8939-939393939393'
);

update phase12_context
set component_product_id = public.create_catalog_product_v3(
  organization_id, null, 'Production Component', 'Phase 12 component',
  'simple', 'P12-COMP', '480000012001', 1000, 500, true, 'each',
  array[store_id], '[]'::jsonb, '', false, false, 'made_to_order'
);

update phase12_context
set made_to_order_product_id = public.create_catalog_product_v3(
  organization_id, null, 'Made To Order Meal', 'Consumes recipe on sale',
  'composite', 'P12-MTO', '480000012002', 2500, 0, true, 'each',
  array[store_id], '[]'::jsonb, '', false, false, 'made_to_order'
);

update phase12_context
set stocked_product_id = public.create_catalog_product_v3(
  organization_id, null, 'Stocked Assembly', 'Consumes recipe during production',
  'composite', 'P12-STOCKED', '480000012003', 3000, 0, true, 'each',
  array[store_id], '[]'::jsonb, '', false, false, 'stocked_assembly'
);

insert into public.product_components (
  organization_id, product_id, component_product_id, component_variant_id, quantity_per_composite
)
select organization_id, made_to_order_product_id, component_product_id, null, 2
from phase12_context
union all
select organization_id, stocked_product_id, component_product_id, null, 2
from phase12_context;

select public.create_inventory_adjustment_reason(
  (select organization_id from phase12_context),
  'P12SEED',
  'Phase 12 seed',
  'OPENING_STOCK'
);

select public.record_inventory_adjustment_v3(
  (select organization_id from phase12_context),
  (select store_id from phase12_context),
  (select component_product_id from phase12_context),
  20,
  'P12SEED',
  'Seed Phase 12 component stock',
  gen_random_uuid()
);

select is(
  (select composite_inventory_mode from public.products where id = (select made_to_order_product_id from phase12_context)),
  'made_to_order',
  'made-to-order mode is persisted explicitly'
);
select is(
  (select composite_inventory_mode from public.products where id = (select stocked_product_id from phase12_context)),
  'stocked_assembly',
  'stocked-assembly mode is persisted explicitly'
);

select throws_ok(
  $$select public.produce_composite(
    (select organization_id from phase12_context),
    (select store_id from phase12_context),
    (select made_to_order_product_id from phase12_context),
    1,
    'Must be rejected',
    gen_random_uuid()
  )$$,
  '23514',
  'Choose an active stocked-assembly composite product.',
  'made-to-order composites cannot be produced into finished stock'
);

update phase12_context
set production_run_id = public.produce_composite(
  organization_id,
  store_id,
  stocked_product_id,
  2,
  'Produce two stocked assemblies',
  production_operation_id
);

select is(
  (select quantity from public.inventory_levels
   where store_id = (select store_id from phase12_context)
     and product_id = (select component_product_id from phase12_context)
     and variant_id is null),
  16::numeric,
  'stocked production consumes recipe components exactly once'
);
select is(
  (select quantity from public.inventory_levels
   where store_id = (select store_id from phase12_context)
     and product_id = (select stocked_product_id from phase12_context)
     and variant_id is null),
  2::numeric,
  'stocked production creates finished inventory'
);
select is(
  (select count(*) from public.production_run_components
   where production_run_id = (select production_run_id from phase12_context)),
  1::bigint,
  'production stores one immutable recipe snapshot row'
);
select is(
  public.produce_composite(
    (select organization_id from phase12_context),
    (select store_id from phase12_context),
    (select stocked_product_id from phase12_context),
    2,
    'Produce two stocked assemblies',
    (select production_operation_id from phase12_context)
  ),
  (select production_run_id from phase12_context),
  'exact production replay returns the original run'
);
select throws_ok(
  $$select public.produce_composite(
    (select organization_id from phase12_context),
    (select store_id from phase12_context),
    (select stocked_product_id from phase12_context),
    3,
    'Produce two stocked assemblies',
    (select production_operation_id from phase12_context)
  )$$,
  '23505',
  'This operation ID is already assigned to a different production payload.',
  'conflicting production replay is rejected'
);

reset role;

select throws_ok(
  $update public.products
    set composite_inventory_mode = 'made_to_order'
    where id = (select stocked_product_id from phase12_context)$,
  '55000',
  'Composite stock mode cannot change after inventory history begins.',
  'composite stock authority is frozen after production history exists'
);

-- The compatibility sale bridge must not consume the stocked assembly recipe.
select private.apply_inventory_change_v2(
  (select organization_id from phase12_context),
  (select store_id from phase12_context),
  (select stocked_product_id from phase12_context),
  null,
  -1,
  'SALE',
  (select actor_employee_id from phase12_context),
  'Phase 12 stocked sale',
  'sale',
  gen_random_uuid(),
  1000
);

select is(
  (select quantity from public.inventory_levels
   where store_id = (select store_id from phase12_context)
     and product_id = (select component_product_id from phase12_context)
     and variant_id is null),
  16::numeric,
  'selling stocked finished inventory does not consume its recipe again'
);

-- Made-to-order keeps the existing sale-time recipe behavior.
select private.apply_inventory_change_v2(
  (select organization_id from phase12_context),
  (select store_id from phase12_context),
  (select made_to_order_product_id from phase12_context),
  null,
  -1,
  'SALE',
  (select actor_employee_id from phase12_context),
  'Phase 12 made-to-order sale',
  'sale',
  gen_random_uuid(),
  0
);

select is(
  (select quantity from public.inventory_levels
   where store_id = (select store_id from phase12_context)
     and product_id = (select component_product_id from phase12_context)
     and variant_id is null),
  14::numeric,
  'made-to-order sale consumes recipe components'
);

select throws_ok(
  $$update public.production_runs
    set note = 'mutated'
    where id = (select production_run_id from phase12_context)$$,
  '55000',
  'Posted production evidence is immutable. Record a new production or correcting stock transaction instead.',
  'production headers are immutable'
);

select throws_ok(
  $$update public.production_run_components
    set quantity_consumed = quantity_consumed
    where production_run_id = (select production_run_id from phase12_context)$$,
  '55000',
  'Posted production evidence is immutable. Record a new production or correcting stock transaction instead.',
  'production component snapshots are immutable'
);

select is(
  (select count(*) from public.inventory_movements
   where source_type = 'production_run'
     and source_id = (select production_run_id from phase12_context)),
  2::bigint,
  'one component and one output movement retain production provenance'
);

select is(
  (select composite_inventory_mode_snapshot from public.production_runs
   where id = (select production_run_id from phase12_context)),
  'stocked_assembly',
  'production freezes the composite mode used by the run'
);

select * from finish();
rollback;
