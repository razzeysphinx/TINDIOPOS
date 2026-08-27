begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table('public', 'smart_menus', 'smart menus table exists');
select has_table('public', 'smart_menu_categories', 'smart menu category selections table exists');
select has_table('public', 'smart_menu_products', 'smart menu product selections table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.smart_menus'::regclass), 'smart menus have RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.smart_menu_categories'::regclass), 'smart menu category selections have RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.smart_menu_products'::regclass), 'smart menu product selections have RLS');
select ok(to_regprocedure('public.save_smart_menu_configuration(uuid,boolean,boolean,boolean,boolean,boolean,boolean,uuid[],uuid[])') is not null, 'authorized Smart Menu save routine exists');
select ok(to_regprocedure('public.get_public_smart_menu(uuid)') is not null, 'narrow public Smart Menu projection exists');
select ok(has_function_privilege('authenticated', 'public.save_smart_menu_configuration(uuid,boolean,boolean,boolean,boolean,boolean,boolean,uuid[],uuid[])', 'execute'), 'authenticated settings managers can call the Smart Menu save routine');
select ok(not has_function_privilege('anon', 'public.save_smart_menu_configuration(uuid,boolean,boolean,boolean,boolean,boolean,boolean,uuid[],uuid[])', 'execute'), 'anonymous callers cannot change Smart Menu settings');
select ok(has_function_privilege('anon', 'public.get_public_smart_menu(uuid)', 'execute'), 'anonymous callers can read the narrow public projection');

insert into auth.users (id, email, raw_user_meta_data)
values ('27272727-2727-4727-8727-272727272728', 'smart-menu-owner@tindio.test', '{"full_name":"Smart Menu Owner"}'::jsonb);

create temporary table smart_menu_context (
  organization_id uuid not null,
  store_id uuid not null,
  category_id uuid,
  product_id uuid,
  menu_id uuid
);
grant select, insert, update on table smart_menu_context to authenticated, anon;

set local role authenticated;
set local request.jwt.claim.sub = '27272727-2727-4727-8727-272727272728';

insert into smart_menu_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization('Smart Menu Retail', 'Smart Menu Main', 'Smart Menu Counter');

with inserted as (
  insert into public.categories (organization_id, name)
  select organization_id, 'Cold drinks'
  from smart_menu_context
  returning id
)
update smart_menu_context
set category_id = (select id from inserted);

update smart_menu_context
set product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Smart Menu Tea',
  'Freshly brewed tea',
  'simple',
  'SMART-TEA',
  '480000099711',
  1200,
  300,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

update public.product_store_settings
set price_override_minor = 1500
where store_id = (select store_id from smart_menu_context)
  and product_id = (select product_id from smart_menu_context);

update smart_menu_context
set menu_id = public.save_smart_menu_configuration(
  store_id,
  true,
  true,
  true,
  false,
  true,
  true,
  array[category_id],
  array[product_id]
);

select ok((select menu_id is not null from smart_menu_context), 'settings manager can save a Smart Menu');
select is((select count(*) from public.audit_logs where organization_id = (select organization_id from smart_menu_context) and event_type = 'SMART_MENU_UPDATED'), 1::bigint, 'Smart Menu configuration is audited');

reset role;
set local role anon;

select is(
  public.get_public_smart_menu((select menu_id from smart_menu_context)) -> 'categories' -> 0 -> 'products' -> 0 ->> 'name',
  'Smart Menu Tea',
  'public projection returns only the selected live catalog product'
);
select is(
  public.get_public_smart_menu((select menu_id from smart_menu_context)) -> 'categories' -> 0 -> 'products' -> 0 ->> 'price_minor',
  '1500',
  'public projection follows the current store price override'
);
select ok(
  not (public.get_public_smart_menu((select menu_id from smart_menu_context)) -> 'categories' -> 0 -> 'products' -> 0 ? 'cost_minor'),
  'public projection excludes catalog cost data'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '27272727-2727-4727-8727-272727272728';

update public.product_store_settings
set is_available = false
where store_id = (select store_id from smart_menu_context)
  and product_id = (select product_id from smart_menu_context);

select is(
  public.save_smart_menu_configuration(
    (select store_id from smart_menu_context),
    true,
    true,
    true,
    false,
    true,
    true,
    array[(select category_id from smart_menu_context)],
    array[(select product_id from smart_menu_context)]
  ),
  (select menu_id from smart_menu_context),
  'saving the same menu keeps its public identifier stable'
);

reset role;
set local role anon;

select is(
  public.get_public_smart_menu((select menu_id from smart_menu_context)) -> 'categories',
  '[]'::jsonb,
  'unavailable products are hidden when sold-out visibility is disabled'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '27272727-2727-4727-8727-272727272728';

select is(
  public.save_smart_menu_configuration(
    (select store_id from smart_menu_context),
    false,
    true,
    true,
    true,
    true,
    true,
    array[(select category_id from smart_menu_context)],
    array[(select product_id from smart_menu_context)]
  ),
  (select menu_id from smart_menu_context),
  'a settings manager can turn off a Smart Menu without changing its identifier'
);

reset role;
set local role anon;

select is(
  public.get_public_smart_menu((select menu_id from smart_menu_context)),
  null::jsonb,
  'a disabled Smart Menu has no anonymous projection'
);

select * from finish();
rollback;
