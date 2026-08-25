begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('b3000000-0000-4000-8000-000000000001', 'workspace-owner@tindio.test', '{"full_name":"Workspace Owner"}'::jsonb),
  ('b3000000-0000-4000-8000-000000000002', 'workspace-unassigned@tindio.test', '{"full_name":"Workspace Unassigned"}'::jsonb);

create temporary table pos_workspace_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  owner_employee_id uuid,
  shift_id uuid,
  product_id uuid,
  sale_id uuid
);

grant select, insert, update on table pos_workspace_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-4000-8000-000000000001';

insert into pos_workspace_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('POS Workspace Test', 'Workspace Store', 'Workspace Register');

update pos_workspace_context context
set owner_employee_id = employee.id
from public.employees employee
where employee.organization_id = context.organization_id
  and employee.profile_id = 'b3000000-0000-4000-8000-000000000001';

update pos_workspace_context
set product_id = public.create_catalog_product_v2(
  organization_id,
  null,
  'Workspace Coffee',
  'A favorite-tile test product',
  'simple',
  'WORKSPACE-COFFEE',
  '480000030001',
  12500,
  0,
  false,
  'cup',
  array[store_id],
  '[]'::jsonb,
  'https://images.example.test/workspace-coffee.png',
  false,
  false
);

update pos_workspace_context context
set shift_id = (
  select opened.shift_id
  from public.open_register_shift(
    context.organization_id,
    context.store_id,
    context.register_id,
    0,
    'Workspace opening cash'
  ) opened
);

select has_table('public', 'pos_favorite_tiles', 'Phase 3 favorite-tile table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.pos_favorite_tiles'::regclass),
  'RLS is enabled on the favorite-tile table'
);
select is(
  (
    select image_url
    from public.search_pos_catalog(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context),
      '480000030001'
    )
  ),
  'https://images.example.test/workspace-coffee.png',
  'POS catalogue search exposes the approved product image URL'
);
select is(
  (
    select count(*)
    from public.get_pos_favorite_items(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context)
    )
  ),
  0::bigint,
  'New POS workspace has no favorites'
);
select is(
  public.set_pos_favorite_tile(
    (select organization_id from pos_workspace_context),
    (select store_id from pos_workspace_context),
    (select product_id from pos_workspace_context),
    null,
    true
  ),
  true,
  'Catalog manager can pin a saleable simple product'
);
select is(
  (
    select count(*)
    from public.get_pos_favorite_items(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context)
    )
  ),
  1::bigint,
  'Pinned product appears once in favorites'
);
select is(
  public.set_pos_favorite_tile(
    (select organization_id from pos_workspace_context),
    (select store_id from pos_workspace_context),
    (select product_id from pos_workspace_context),
    null,
    true
  ),
  true,
  'Pinning the same item is idempotent'
);
select is(
  (
    select count(*)
    from public.get_pos_favorite_items(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context)
    )
  ),
  1::bigint,
  'Idempotent pin does not create duplicate tiles'
);
select is(
  public.set_pos_favorite_tile(
    (select organization_id from pos_workspace_context),
    (select store_id from pos_workspace_context),
    (select product_id from pos_workspace_context),
    null,
    false
  ),
  false,
  'Catalog manager can unpin an item'
);
select is(
  (
    select count(*)
    from public.get_pos_favorite_items(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context)
    )
  ),
  0::bigint,
  'Unpinned item is removed from favorites'
);

reset role;
create temporary table inserted_workspace_sale (id uuid not null);

with inserted_sale as (
  insert into public.sales (
    organization_id,
    store_id,
    register_id,
    shift_id,
    cashier_employee_id,
    currency_code,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot,
    status,
    subtotal_minor,
    total_minor
  )
  select
    context.organization_id,
    context.store_id,
    context.register_id,
    context.shift_id,
    context.owner_employee_id,
    'PHP',
    'POS Workspace Test',
    'Workspace Store',
    'Workspace Register',
    'Workspace Owner',
    'completed',
    12500,
    12500
  from pos_workspace_context context
  returning id
)
insert into inserted_workspace_sale (id)
select id
from inserted_sale;

update pos_workspace_context
set sale_id = (select id from inserted_workspace_sale);

insert into public.sale_items (
  organization_id,
  sale_id,
  product_id,
  product_name_snapshot,
  sku_snapshot,
  unit_snapshot,
  quantity,
  unit_price_minor,
  line_total_minor
)
select
  organization_id,
  sale_id,
  product_id,
  'Workspace Coffee',
  'WORKSPACE-COFFEE',
  'cup',
  1,
  12500,
  12500
from pos_workspace_context;

set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-4000-8000-000000000001';

select is(
  (
    select product_name
    from public.get_pos_recent_items(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context),
      12
    )
  ),
  'Workspace Coffee',
  'Recently completed sale provides a current saleable quick tile'
);
select ok(
  not has_table_privilege('authenticated', 'public.pos_favorite_tiles', 'select'),
  'Favorite tiles have no direct authenticated table grant'
);
select throws_ok(
  $$
    select *
    from public.get_pos_recent_items(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context),
      25
    );
  $$,
  '22023',
  'Recent item limit must be between 1 and 24.',
  'Recent-item function rejects oversized pages'
);

reset role;
insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, 'b3000000-0000-4000-8000-000000000002', 'WORKSPACE-CASH-002', 'Cashier'
from pos_workspace_context;

insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'cashier'
where employee.profile_id = 'b3000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = 'b3000000-0000-4000-8000-000000000002';

select throws_ok(
  $$
    select *
    from public.get_pos_favorite_items(
      (select organization_id from pos_workspace_context),
      (select store_id from pos_workspace_context)
    );
  $$,
  '42501',
  'The selected store is not assigned to this employee.',
  'Unassigned cashier cannot access another store’s POS workspace'
);

select * from finish();
rollback;
