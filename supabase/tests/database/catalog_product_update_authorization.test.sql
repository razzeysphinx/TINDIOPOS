begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('28282828-2828-4828-8828-282828282828', 'catalog-update-owner@tindio.test', '{"full_name":"Catalog Update Owner"}'::jsonb),
  ('29292929-2929-4929-8929-292929292929', 'catalog-update-unapproved@tindio.test', '{"full_name":"Catalog Update Unapproved"}'::jsonb);

create temporary table catalog_update_context (
  organization_id uuid not null,
  store_id uuid not null,
  secondary_store_id uuid,
  product_id uuid
);

grant select, insert, update on table catalog_update_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '28282828-2828-4828-8828-282828282828';

insert into catalog_update_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization(
  'Catalog Update Authorization',
  'Catalog Update Main',
  'Catalog Update Counter'
);

update catalog_update_context
set product_id = public.create_catalog_product_v2(
  organization_id,
  null,
  'Original catalog product',
  '',
  'simple',
  'CATALOG-UPDATE-1',
  '480000002828',
  100,
  40,
  false,
  'each',
  array[store_id],
  '[]'::jsonb,
  '',
  false,
  false
);

reset role;

with inserted_store as (
  insert into public.stores (organization_id, name, code)
  select organization_id, 'Catalog Update Secondary', 'CAT-UPD-2'
  from catalog_update_context
  returning id
)
update catalog_update_context
set secondary_store_id = (select id from inserted_store);

set local role authenticated;
set local request.jwt.claim.sub = '28282828-2828-4828-8828-282828282828';

select ok(
  to_regprocedure('public.update_catalog_product_v2(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean)') is not null,
  'the catalog product update routine exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.update_catalog_product_v2(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean)',
    'EXECUTE'
  ),
  'authenticated callers can invoke the guarded catalog update routine'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.update_catalog_product_v2(uuid,uuid,text,text,uuid,text,text,bigint,bigint,boolean,text,text,boolean,boolean)',
    'EXECUTE'
  ),
  'anonymous callers cannot invoke the catalog update routine'
);

select ok(
  not has_column_privilege('authenticated', 'public.products', 'name', 'UPDATE'),
  'direct product-name updates remain unavailable to authenticated clients'
);

insert into public.product_store_settings (
  organization_id,
  product_id,
  store_id,
  is_available
)
select organization_id, product_id, secondary_store_id, true
from catalog_update_context
on conflict (store_id, product_id) do update
set is_available = excluded.is_available;

select is(
  (
    select count(*)
    from public.product_store_settings
    where product_id = (select product_id from catalog_update_context)
      and is_available
  ),
  2::bigint,
  'an authorized owner can add a product to another active store'
);

update public.product_store_settings
set is_available = false
where product_id = (select product_id from catalog_update_context)
  and store_id = (select store_id from catalog_update_context);

select is(
  (
    select is_available
    from public.product_store_settings
    where product_id = (select product_id from catalog_update_context)
      and store_id = (select store_id from catalog_update_context)
  ),
  false,
  'an authorized owner can remove a product from one store by making it unavailable'
);

select is(
  public.update_catalog_product_v2(
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context),
    'Updated catalog product',
    'Updated through the guarded routine',
    null,
    'CATALOG-UPDATE-2',
    '480000002829',
    125,
    50,
    true,
    'Each',
    'https://example.test/catalog-update.png',
    false,
    false
  ),
  'simple',
  'an authorized owner can update product details through the guarded routine'
);

reset role;

select is(
  (
    select name
    from public.products
    where id = (select product_id from catalog_update_context)
  ),
  'Updated catalog product',
  'the guarded update persists the requested product details'
);

select is(
  (
    select count(*)
    from public.products
    where id = (select product_id from catalog_update_context)
  ),
  1::bigint,
  'removing store availability does not delete the product master'
);

set local role authenticated;
set local request.jwt.claim.sub = '29292929-2929-4929-8929-292929292929';

select throws_ok(
  format(
    $$select public.update_catalog_product_v2(%L, %L, 'Unauthorized catalog product', '', null, '', '', 0, 0, false, 'each', '', false, false)$$,
    (select organization_id from catalog_update_context),
    (select product_id from catalog_update_context)
  ),
  '42501',
  'Product management permission is required.',
  'a caller without product-management permission cannot update the product'
);

select * from finish();
rollback;
