begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '96000000-0000-4000-8000-000000000001',
  'stock-page-owner@tindio.test',
  '{"full_name":"Stock Page Owner"}'::jsonb
);

create temporary table inventory_stock_page_context (
  organization_id uuid not null,
  store_id uuid not null,
  simple_product_id uuid,
  variable_product_id uuid
);

grant select, insert, update on inventory_stock_page_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '96000000-0000-4000-8000-000000000001';

insert into inventory_stock_page_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization(
  'Stock Page Execution Test',
  'Stock Page Store',
  'Stock Page Register'
);

update inventory_stock_page_context
set simple_product_id = public.create_catalog_product(
  organization_id,
  null,
  'Stock Page Simple Item',
  'Simple tracked item for the bounded stock reader.',
  'simple',
  'STOCK-PAGE-SIMPLE',
  '480000096000',
  1000,
  500,
  true,
  'each',
  array[store_id],
  '[]'::jsonb
);

update inventory_stock_page_context
set variable_product_id = public.create_catalog_product(
  organization_id,
  null,
  'Stock Page Variable Item',
  'Variable tracked item for distinct-product metrics.',
  'variable',
  '',
  '',
  0,
  0,
  true,
  'each',
  array[store_id],
  '[
    {
      "name":"Small",
      "option_values":{"Size":"Small"},
      "sku":"STOCK-PAGE-S",
      "barcode":"480000096001",
      "price_minor":1200,
      "cost_minor":600,
      "sort_order":0
    },
    {
      "name":"Large",
      "option_values":{"Size":"Large"},
      "sku":"STOCK-PAGE-L",
      "barcode":"480000096002",
      "price_minor":1200,
      "cost_minor":600,
      "sort_order":1
    }
  ]'::jsonb
);

select is(
  (
    select count(*)
    from public.get_inventory_stock_page(
      (select organization_id from inventory_stock_page_context),
      (select store_id from inventory_stock_page_context),
      requested_page_size => 2
    )
  ),
  2::bigint,
  'the bounded stock reader executes and respects its page size'
);

select is(
  (
    select min(total_count)
    from public.get_inventory_stock_page(
      (select organization_id from inventory_stock_page_context),
      (select store_id from inventory_stock_page_context),
      requested_page_size => 2
    )
  ),
  3::bigint,
  'the stock reader reports all simple and variant positions before paging'
);

select is(
  (
    select min(active_product_count)
    from public.get_inventory_stock_page(
      (select organization_id from inventory_stock_page_context),
      (select store_id from inventory_stock_page_context),
      requested_page_size => 2
    )
  ),
  2::bigint,
  'stock metrics count distinct products rather than variant positions'
);

select is(
  (
    select count(distinct product_id)
    from public.get_inventory_stock_page(
      (select organization_id from inventory_stock_page_context),
      (select store_id from inventory_stock_page_context),
      requested_page_size => 100
    )
  ),
  2::bigint,
  'the stock page returns both tracked products within the selected store scope'
);

select * from finish();

rollback;
