begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(
  has_column_privilege('authenticated', 'public.inventory_movements', 'unit_snapshot', 'select'),
  'authorized inventory activity can read the immutable unit snapshot without receiving cost fields'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_movements'
      and policyname = 'inventory_movements_select_authorized'
      and qual like '%inventory.view%'
      and qual like '%inventory.adjust.create%'
      and qual like '%inventory.adjust.post%'
      and qual like '%inventory.count.create%'
      and qual like '%inventory.count.finalize%'
      and qual like '%has_store_read_scope%'
  ),
  'movement history keeps adjusters and counters within the same store-scoped RLS boundary as the workspace'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_levels'
      and policyname = 'inventory_levels_select_authorized_scope'
      and qual like '%inventory.view%'
      and qual like '%inventory.adjust.create%'
      and qual like '%inventory.adjust.post%'
      and qual like '%inventory.count.create%'
      and qual like '%inventory.count.finalize%'
      and qual like '%inventory.transfer.create%'
      and qual like '%inventory.transfer.send%'
      and qual like '%inventory.transfer.receive%'
      and qual like '%purchasing.po.create%'
      and qual like '%purchasing.receive%'
      and qual like '%purchasing.return%'
      and qual like '%inventory.manage%'
      and qual like '%inventory.valuation.view%'
      and qual like '%products.view_cost%'
      and qual like '%has_store_read_scope%'
  ),
  'the stock projection read policy certifies granular operational capabilities with store scope'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'inventory_movements'
      and indexname = 'inventory_movements_source_lookup_idx'
  ),
  'source-document activity lookups remain index-backed'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('81818181-8181-4818-8818-818181818181', 'operational-stock-owner@tindio.test', '{"full_name":"Operational Stock Owner"}'::jsonb),
  ('81818181-8181-4818-8818-818181818182', 'operational-stock-adjust@tindio.test', '{"full_name":"Operational Stock Adjust"}'::jsonb),
  ('81818181-8181-4818-8818-818181818183', 'operational-stock-count@tindio.test', '{"full_name":"Operational Stock Count"}'::jsonb),
  ('81818181-8181-4818-8818-818181818184', 'operational-stock-transfer@tindio.test', '{"full_name":"Operational Stock Transfer"}'::jsonb),
  ('81818181-8181-4818-8818-818181818185', 'operational-stock-view@tindio.test', '{"full_name":"Operational Stock View"}'::jsonb);

create temporary table inventory_operational_stock_context (
  organization_id uuid not null,
  source_store_id uuid not null,
  destination_store_id uuid,
  unrelated_store_id uuid,
  product_id uuid
);
grant select, insert, update on inventory_operational_stock_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '81818181-8181-4818-8818-818181818181';

insert into inventory_operational_stock_context (organization_id, source_store_id)
select organization_id, store_id
from public.bootstrap_organization(
  'Operational Stock RLS Retail',
  'Operational Stock Source',
  'Operational Stock Register'
);

with destination_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Operational Stock Destination', 'OPS-DST'
  from inventory_operational_stock_context
  returning id
), unrelated_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Operational Stock Unrelated', 'OPS-OTHER'
  from inventory_operational_stock_context
  returning id
)
update inventory_operational_stock_context
set destination_store_id = (select id from destination_store),
    unrelated_store_id = (select id from unrelated_store);

update inventory_operational_stock_context context
set product_id = public.create_catalog_product(
  organization_id,
  null,
  'Operational Stock Item',
  'Custom-role operational stock RLS coverage.',
  'simple',
  'OPERATIONAL-STOCK-ITEM',
  '480000099181',
  1000,
  100,
  true,
  'each',
  array[source_store_id, destination_store_id, unrelated_store_id],
  '[]'::jsonb
);

reset role;

insert into public.employees (organization_id, profile_id, employee_number, job_title)
select context.organization_id, profile_id, employee_number, 'Operational stock custom role'
from inventory_operational_stock_context context
cross join (values
  ('81818181-8181-4818-8818-818181818182'::uuid, 'OPS-ADJUST-001'),
  ('81818181-8181-4818-8818-818181818183'::uuid, 'OPS-COUNT-001'),
  ('81818181-8181-4818-8818-818181818184'::uuid, 'OPS-TRANSFER-001'),
  ('81818181-8181-4818-8818-818181818185'::uuid, 'OPS-VIEW-001')
) as employee(profile_id, employee_number);

insert into public.roles (organization_id, name, code, is_system)
select context.organization_id, name, code, false
from inventory_operational_stock_context context
cross join (values
  ('Adjustment-only operational stock role', 'operational_stock_adjust_only'),
  ('Count-only operational stock role', 'operational_stock_count_only'),
  ('Transfer-only operational stock role', 'operational_stock_transfer_only'),
  ('Inventory-view operational stock role', 'operational_stock_view_only')
) as role(name, code);

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, permission_code
from public.roles role
join inventory_operational_stock_context context on context.organization_id = role.organization_id
cross join lateral unnest(
  case role.code
    when 'operational_stock_adjust_only' then array['inventory.adjust.create', 'inventory.adjust.post']::text[]
    when 'operational_stock_count_only' then array['inventory.count.create', 'inventory.count.finalize']::text[]
    when 'operational_stock_transfer_only' then array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']::text[]
    when 'operational_stock_view_only' then array['inventory.view']::text[]
  end
) permission_code
where role.code in (
  'operational_stock_adjust_only',
  'operational_stock_count_only',
  'operational_stock_transfer_only',
  'operational_stock_view_only'
);

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join inventory_operational_stock_context context on context.organization_id = employee.organization_id
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = case employee.profile_id
   when '81818181-8181-4818-8818-818181818182'::uuid then 'operational_stock_adjust_only'
   when '81818181-8181-4818-8818-818181818183'::uuid then 'operational_stock_count_only'
   when '81818181-8181-4818-8818-818181818184'::uuid then 'operational_stock_transfer_only'
   when '81818181-8181-4818-8818-818181818185'::uuid then 'operational_stock_view_only'
 end
where employee.profile_id in (
  '81818181-8181-4818-8818-818181818182'::uuid,
  '81818181-8181-4818-8818-818181818183'::uuid,
  '81818181-8181-4818-8818-818181818184'::uuid,
  '81818181-8181-4818-8818-818181818185'::uuid
);

insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, store_id
from public.employees employee
join inventory_operational_stock_context context on context.organization_id = employee.organization_id
cross join lateral unnest(
  case employee.profile_id
    when '81818181-8181-4818-8818-818181818184'::uuid
      then array[context.source_store_id, context.destination_store_id]
    else array[context.source_store_id]
  end
) store_id
where employee.profile_id in (
  '81818181-8181-4818-8818-818181818182'::uuid,
  '81818181-8181-4818-8818-818181818183'::uuid,
  '81818181-8181-4818-8818-818181818184'::uuid,
  '81818181-8181-4818-8818-818181818185'::uuid
);

set local role authenticated;
set local request.jwt.claim.sub = '81818181-8181-4818-8818-818181818182';
select is(
  (select count(*) from public.inventory_levels where organization_id = (select organization_id from inventory_operational_stock_context)),
  1::bigint,
  'adjustment-only custom role can read assigned-store operational stock'
);
select is(
  (select count(*) from public.inventory_levels where store_id = (select unrelated_store_id from inventory_operational_stock_context)),
  0::bigint,
  'adjustment-only custom role cannot read unrelated-store operational stock'
);

set local request.jwt.claim.sub = '81818181-8181-4818-8818-818181818183';
select is(
  (select count(*) from public.inventory_levels where organization_id = (select organization_id from inventory_operational_stock_context)),
  1::bigint,
  'count-only custom role can read assigned-store operational stock'
);
select is(
  (select count(*) from public.inventory_levels where store_id = (select unrelated_store_id from inventory_operational_stock_context)),
  0::bigint,
  'count-only custom role cannot read unrelated-store operational stock'
);

set local request.jwt.claim.sub = '81818181-8181-4818-8818-818181818184';
select is(
  (select count(*) from public.inventory_levels where organization_id = (select organization_id from inventory_operational_stock_context)),
  2::bigint,
  'transfer-only custom role can read source and destination operational stock'
);
select is(
  (select count(*) from public.inventory_levels where store_id = (select unrelated_store_id from inventory_operational_stock_context)),
  0::bigint,
  'transfer-only custom role cannot read unrelated-store operational stock'
);

set local request.jwt.claim.sub = '81818181-8181-4818-8818-818181818185';
select is(
  (select count(*) from public.inventory_levels where organization_id = (select organization_id from inventory_operational_stock_context)),
  1::bigint,
  'inventory-view custom role can read assigned-store operational stock'
);
select is(
  (select count(*) from public.inventory_levels where store_id = (select unrelated_store_id from inventory_operational_stock_context)),
  0::bigint,
  'inventory-view custom role cannot read unrelated-store operational stock'
);

select * from finish();

rollback;
