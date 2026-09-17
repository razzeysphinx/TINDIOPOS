begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

create function pg_temp.rejected_with_state(statement text, expected_state text)
returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when others then
  return sqlstate = expected_state;
end;
$$;

select has_function('public', 'record_inventory_adjustment_v3', array['uuid','uuid','uuid','numeric','text','text','uuid','uuid','uuid'], 'canonical adjustment command exists');
select ok(has_function_privilege('authenticated', 'public.record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)', 'execute'), 'authenticated callers can reach the guarded canonical command');
select ok(not has_function_privilege('authenticated', 'public.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text,uuid)', 'execute'), 'legacy adjustment adapter remains revoked');
select ok(not has_function_privilege('authenticated', 'public.record_inventory_adjustment_v2(uuid,uuid,uuid,uuid,numeric,text,text)', 'execute'), 'legacy v2 adjustment command remains revoked');
select ok(not has_function_privilege('authenticated', 'public.import_inventory_adjustments_csv(uuid,uuid,text,jsonb)', 'execute'), 'legacy CSV command remains revoked');
select ok(pg_get_functiondef('private.post_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)'::regprocedure) like '%on conflict (organization_id, operation_id) do nothing%', 'canonical core reserves one operation document safely');
select ok(pg_get_functiondef('private.post_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)'::regprocedure) like '%Opening stock can only be recorded once for an item with no prior movement.%', 'opening stock is restricted to an untouched position');
select ok(pg_get_functiondef('private.post_inventory_adjustment(uuid,uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)'::regprocedure) like '%private.apply_inventory_change_v2%', 'adjustments use the canonical projection and ledger helper');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('97000000-0000-4000-8000-000000000001', 'phase07-owner@tindio.test', '{"full_name":"Phase 07 Owner"}'::jsonb),
  ('97000000-0000-4000-8000-000000000002', 'phase07-other@tindio.test', '{"full_name":"Phase 07 Other Owner"}'::jsonb),
  ('97000000-0000-4000-8000-000000000003', 'phase07-scoped@tindio.test', '{"full_name":"Phase 07 Scoped Adjuster"}'::jsonb);

create temporary table phase_07_context (
  organization_id uuid,
  store_id uuid,
  opening_product_id uuid,
  adjustment_product_id uuid,
  opening_operation_id uuid default gen_random_uuid(),
  positive_operation_id uuid default gen_random_uuid(),
  negative_operation_id uuid default gen_random_uuid(),
  other_organization_id uuid,
  other_store_id uuid,
  unauthorized_store_id uuid,
  scoped_employee_id uuid
);
grant select, insert, update on phase_07_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '97000000-0000-4000-8000-000000000001';
insert into phase_07_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization('Phase 07 Adjustments', 'Phase 07 Store', 'Phase 07 Register');
reset role;

with created_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Phase 07 Unauthorized Store', 'P07-UNAUTHORIZED'
  from phase_07_context
  returning id
)
update phase_07_context context
set unauthorized_store_id = created_store.id
from created_store;

set local role authenticated;
set local request.jwt.claim.sub = '97000000-0000-4000-8000-000000000002';
with setup as (
  select * from public.bootstrap_organization('Phase 07 Other', 'Phase 07 Other Store', 'Phase 07 Other Register')
)
update phase_07_context context
set other_organization_id = setup.organization_id,
    other_store_id = setup.store_id
from setup;
reset role;

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '97000000-0000-4000-8000-000000000003', 'P07-SCOPED', 'Scoped inventory adjuster'
from phase_07_context;
update phase_07_context context
set scoped_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = '97000000-0000-4000-8000-000000000003';
insert into public.roles (organization_id, name, code, is_system)
select organization_id, 'Phase 07 Adjuster', 'phase_07_adjuster', false from phase_07_context;
insert into public.role_permissions (organization_id, role_id, permission_code)
select context.organization_id, role.id, permission_code
from phase_07_context context
join public.roles role on role.organization_id=context.organization_id and role.code='phase_07_adjuster'
cross join unnest(array['inventory.adjust','inventory.adjust.post']) permission_code;
insert into public.employee_roles (organization_id, employee_id, role_id)
select context.organization_id, context.scoped_employee_id, role.id
from phase_07_context context
join public.roles role on role.organization_id=context.organization_id and role.code='phase_07_adjuster';
insert into public.employee_stores (organization_id, employee_id, store_id)
select organization_id, scoped_employee_id, store_id from phase_07_context;

insert into public.inventory_adjustment_reasons (organization_id, code, name, movement_type)
select organization_id, 'INITIAL', 'Opening stock', 'OPENING_STOCK' from phase_07_context
union all
select organization_id, 'CORRECTION', 'Manual correction', 'ADJUSTMENT' from phase_07_context
union all
select other_organization_id, 'CORRECTION', 'Manual correction', 'ADJUSTMENT' from phase_07_context;

set local role authenticated;
set local request.jwt.claim.sub = '97000000-0000-4000-8000-000000000001';
update phase_07_context context set
  opening_product_id = public.create_catalog_product(
    context.organization_id, null, 'Opening item', 'Phase 07 opening stock item', 'simple',
    'PHASE07-OPEN', '4800000009701', 1000, 400, true, 'each', array[context.store_id], '[]'::jsonb
  ),
  adjustment_product_id = public.create_catalog_product(
    context.organization_id, null, 'Adjustment item', 'Phase 07 signed adjustment item', 'simple',
    'PHASE07-ADJUST', '4800000009702', 1200, 500, true, 'each', array[context.store_id, context.unauthorized_store_id], '[]'::jsonb
  );

select lives_ok(format(
  $$select public.record_inventory_adjustment_v3(%L,%L,%L,10,'INITIAL','Initial counted stock',%L,null,null)$$,
  organization_id, store_id, opening_product_id, opening_operation_id
), 'opening stock posts through the canonical command') from phase_07_context;
reset role;

select is((select quantity from public.inventory_levels level join phase_07_context context on level.organization_id=context.organization_id and level.store_id=context.store_id and level.product_id=context.opening_product_id), 10::numeric, 'opening stock updates the projection once');
select is((select count(*) from public.inventory_movements movement join phase_07_context context on movement.organization_id=context.organization_id and movement.product_id=context.opening_product_id), 1::bigint, 'opening stock emits exactly one ledger movement');
select is((select movement_type from public.inventory_movements movement join phase_07_context context on movement.organization_id=context.organization_id and movement.product_id=context.opening_product_id), 'OPENING_STOCK', 'opening stock retains its first-class movement type');
select ok((select source_type='inventory_adjustment' and source_id is not null and operation_id is not null from public.inventory_movements movement join phase_07_context context on movement.organization_id=context.organization_id and movement.product_id=context.opening_product_id), 'opening stock carries immutable adjustment and operation identity');
select ok(exists(select 1 from public.audit_logs audit join phase_07_context context on audit.organization_id=context.organization_id where audit.event_type='INVENTORY_ADJUSTED' and audit.metadata->>'operation_id'=context.opening_operation_id::text), 'opening stock writes audit evidence');

set local role authenticated;
set local request.jwt.claim.sub = '97000000-0000-4000-8000-000000000001';
select lives_ok(format(
  $$select public.record_inventory_adjustment_v3(%L,%L,%L,10,'INITIAL','Initial counted stock',%L,null,null)$$,
  organization_id, store_id, opening_product_id, opening_operation_id
), 'exact opening-stock retry returns the original result') from phase_07_context;
reset role;
select is((select count(*) from public.inventory_movements movement join phase_07_context context on movement.organization_id=context.organization_id and movement.product_id=context.opening_product_id), 1::bigint, 'opening-stock retry does not duplicate stock');

set local role authenticated;
set local request.jwt.claim.sub = '97000000-0000-4000-8000-000000000001';
select throws_ok(format(
  $$select public.record_inventory_adjustment_v3(%L,%L,%L,2,'INITIAL','A second opening balance',gen_random_uuid(),null,null)$$,
  organization_id, store_id, opening_product_id
), '23514', 'Opening stock can only be recorded once for an item with no prior movement.', 'a second opening-stock operation is rejected') from phase_07_context;

select lives_ok(format(
  $$select public.record_inventory_adjustment_v3(%L,%L,%L,7,'CORRECTION','Found during shelf review',%L,null,null)$$,
  organization_id, store_id, adjustment_product_id, positive_operation_id
), 'positive manual adjustment succeeds') from phase_07_context;
select lives_ok(format(
  $$select public.record_inventory_adjustment_v3(%L,%L,%L,-2,'CORRECTION','Damaged during handling',%L,null,null)$$,
  organization_id, store_id, adjustment_product_id, negative_operation_id
), 'negative manual adjustment succeeds') from phase_07_context;
reset role;

select is((select quantity from public.inventory_levels level join phase_07_context context on level.organization_id=context.organization_id and level.store_id=context.store_id and level.product_id=context.adjustment_product_id), 5::numeric, 'signed adjustments reconcile to the projection');
select is((select count(*) from public.inventory_movements movement join phase_07_context context on movement.organization_id=context.organization_id and movement.product_id=context.adjustment_product_id), 2::bigint, 'signed adjustments emit one movement each');
select is((select count(*) from public.inventory_movements movement join phase_07_context context on movement.organization_id=context.organization_id and movement.product_id=context.adjustment_product_id where quantity_after=quantity_before+quantity_delta), 2::bigint, 'every adjustment movement satisfies ledger arithmetic');
select is((select sum(quantity_delta) from public.inventory_movements movement join phase_07_context context on movement.organization_id=context.organization_id and movement.product_id=context.adjustment_product_id), 5::numeric, 'ledger-derived quantity equals the projection');

set local role authenticated;
set local request.jwt.claim.sub = '97000000-0000-4000-8000-000000000001';
select ok(pg_temp.rejected_with_state(format(
  $$select public.record_inventory_adjustment_v3(%L,%L,%L,1,'CORRECTION','Cross organization attempt',gen_random_uuid(),null,null)$$,
  other_organization_id, other_store_id, adjustment_product_id
), '42501'), 'cross-organization direct RPC invocation is denied') from phase_07_context;
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '97000000-0000-4000-8000-000000000003';
select ok(pg_temp.rejected_with_state(format(
  $$select public.record_inventory_adjustment_v3(%L,%L,%L,1,'CORRECTION','Unauthorized store attempt',gen_random_uuid(),null,null)$$,
  organization_id, unauthorized_store_id, adjustment_product_id
), '42501'), 'store-scoped adjuster cannot mutate an unassigned store') from phase_07_context;
reset role;

select * from finish();
rollback;
