begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

select ok(
  to_regprocedure('private.inventory_transfer_child_operation_id(uuid,text)') is not null,
  'deterministic child operation helper exists'
);

create temporary table phase_05_repair_context (
  organization_id uuid,
  source_store_id uuid,
  destination_store_id uuid,
  register_id uuid,
  product_id uuid,
  transfer_id uuid,
  external_operation_id uuid not null default 'c5000000-0000-4000-8000-000000000001'
);
grant select, insert, update on phase_05_repair_context to authenticated;
grant select, delete on private.stock_transfer_operations to authenticated;
grant execute on function private.inventory_transfer_child_operation_id(uuid, text) to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'c5050505-0505-4505-8505-050505050505';
reset role;
insert into auth.users (id, email, raw_user_meta_data)
values ('c5050505-0505-4505-8505-050505050505', 'phase05-contract-repair@tindio.test', '{"full_name":"Phase 05 Contract Repair"}'::jsonb);
set local role authenticated;
set local request.jwt.claim.sub = 'c5050505-0505-4505-8505-050505050505';

insert into phase_05_repair_context (organization_id, source_store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Phase 05 Contract Repair', 'Repair Source', 'Repair Counter');

with destination as (
  insert into public.stores (organization_id, name, code)
  values ((select organization_id from phase_05_repair_context), 'Repair Destination', 'REPAIR-DEST')
  returning id
)
update phase_05_repair_context set destination_store_id = destination.id from destination;

insert into public.employee_stores (organization_id, employee_id, store_id)
select context.organization_id, employee.id, context.destination_store_id
from phase_05_repair_context context
join public.employees employee on employee.organization_id = context.organization_id
where employee.profile_id = auth.uid();

update phase_05_repair_context
set product_id = public.create_catalog_product(
  organization_id, null, 'Repair Item', 'Phase 05 repair item', 'simple',
  'PHASE05-REPAIR', '480000005050', 2500, 1000, true, 'each',
  array[source_store_id, destination_store_id], '[]'::jsonb
);
select public.create_inventory_adjustment_reason(
  (select organization_id from phase_05_repair_context),
  'REPAIR_SEED', 'Repair opening stock', 'ADJUSTMENT'
);
select public.record_inventory_adjustment_v3(
  (select organization_id from phase_05_repair_context),
  (select source_store_id from phase_05_repair_context),
  (select product_id from phase_05_repair_context),
  20, 'REPAIR_SEED', 'Seed repair stock', 'c5000000-0000-4000-8000-000000000002'
);

select is(
  private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'submit'),
  private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'submit'),
  'submit child identity is deterministic'
);
select is(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'approve'), private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'approve'), 'approve child identity is deterministic');
select is(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'dispatch'), private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'dispatch'), 'dispatch child identity is deterministic');
select isnt(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'submit'), private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'approve'), 'submit and approve identities differ');
select isnt(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'approve'), private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'dispatch'), 'approve and dispatch identities differ');
select isnt(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'submit'), private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'dispatch'), 'submit and dispatch identities differ');
select isnt(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'submit'), 'c5000000-0000-4000-8000-000000000001'::uuid, 'submit child differs from parent');
select isnt(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'approve'), 'c5000000-0000-4000-8000-000000000001'::uuid, 'approve child differs from parent');
select isnt(private.inventory_transfer_child_operation_id('c5000000-0000-4000-8000-000000000001', 'dispatch'), 'c5000000-0000-4000-8000-000000000001'::uuid, 'dispatch child differs from parent');

update phase_05_repair_context set transfer_id = public.create_direct_stock_transfer(
  organization_id, source_store_id, destination_store_id,
  jsonb_build_array(jsonb_build_object('product_id', product_id, 'variant_id', null, 'quantity', '6')),
  'Deterministic direct transfer', external_operation_id
);

select is((select count(*) from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context)), 4::bigint, 'registry contains the four canonical transitions');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context) and command = 'create'), (select external_operation_id from phase_05_repair_context), 'create identity is the external operation ID');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context) and command = 'submit'), private.inventory_transfer_child_operation_id((select external_operation_id from phase_05_repair_context), 'submit'), 'submit registry identity is helper-derived');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context) and command = 'approve'), private.inventory_transfer_child_operation_id((select external_operation_id from phase_05_repair_context), 'approve'), 'approve registry identity is helper-derived');
select is((select operation_id from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context) and command = 'dispatch'), private.inventory_transfer_child_operation_id((select external_operation_id from phase_05_repair_context), 'dispatch'), 'dispatch registry identity is helper-derived');
select is((select count(distinct operation_id) from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context)), 4::bigint, 'all four transition identities are distinct');
select is(
  public.create_direct_stock_transfer(
    (select organization_id from phase_05_repair_context), (select source_store_id from phase_05_repair_context),
    (select destination_store_id from phase_05_repair_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from phase_05_repair_context), 'variant_id', null, 'quantity', '6')),
    'Deterministic direct transfer', (select external_operation_id from phase_05_repair_context)
  ),
  (select transfer_id from phase_05_repair_context),
  'exact retry returns the same transfer'
);
select is((select count(*) from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context)), 4::bigint, 'exact retry creates no registry rows');
select is((select count(*) from public.inventory_movements where source_type = 'stock_transfer' and source_id = (select transfer_id from phase_05_repair_context) and movement_type = 'TRANSFER_OUT'), 1::bigint, 'exact retry creates no second source movement');
select throws_ok(
  format($$select public.create_direct_stock_transfer(%L,%L,%L,%L::jsonb,'Changed note',%L)$$,
    (select organization_id from phase_05_repair_context), (select source_store_id from phase_05_repair_context),
    (select destination_store_id from phase_05_repair_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from phase_05_repair_context), 'variant_id', null, 'quantity', '6')),
    (select external_operation_id from phase_05_repair_context)),
  '23505', 'This operation ID is already assigned to a different transfer.',
  'conflicting retry is rejected'
);

delete from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context);
select is(
  public.create_direct_stock_transfer(
    (select organization_id from phase_05_repair_context), (select source_store_id from phase_05_repair_context),
    (select destination_store_id from phase_05_repair_context),
    jsonb_build_array(jsonb_build_object('product_id', (select product_id from phase_05_repair_context), 'variant_id', null, 'quantity', '6')),
    'Deterministic direct transfer', (select external_operation_id from phase_05_repair_context)
  ),
  (select transfer_id from phase_05_repair_context),
  'historical external-operation retry returns the existing transfer'
);
select is((select count(*) from private.stock_transfer_operations where stock_transfer_id = (select transfer_id from phase_05_repair_context)), 0::bigint, 'historical retry does not fabricate child operation history');

select * from finish();
rollback;
