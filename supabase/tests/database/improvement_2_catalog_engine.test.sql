begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

select has_table('public', 'product_units', 'product_units table exists');
select has_table('public', 'product_components', 'product_components table exists');
select has_column('public', 'products', 'image_url', 'products support image URLs');
select has_column('public', 'products', 'is_variable_price', 'products support variable price mode');
select has_column('public', 'products', 'allow_fractional_quantity', 'products support fractional quantities');
select has_column('public', 'product_store_settings', 'price_override_minor', 'store settings support price overrides');
select has_column('public', 'product_store_settings', 'low_stock_level', 'store settings support low-stock levels');
select ok((select relrowsecurity from pg_class where oid = 'public.product_units'::regclass), 'product units have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.product_components'::regclass), 'product components have RLS');
select ok(to_regprocedure('public.create_catalog_product_v2(uuid,uuid,text,text,text,text,text,bigint,bigint,boolean,text,uuid[],jsonb,text,boolean,boolean)') is not null, 'extended product creation function exists');
select ok(to_regprocedure('private.record_composite_component_movements()') is not null, 'composite stock ledger trigger function exists');

insert into auth.users (id, email, raw_user_meta_data)
values ('24242424-2424-4424-8424-242424242424', 'catalog-owner@tindio.test', '{"full_name":"Catalog Owner"}'::jsonb);

create temporary table catalog_improvement_context (
  organization_id uuid not null,
  store_id uuid not null,
  parent_product_id uuid,
  component_product_id uuid,
  variable_product_id uuid,
  register_id uuid,
  actor_employee_id uuid
);
grant select, insert, update on catalog_improvement_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '24242424-2424-4424-8424-242424242424';

insert into catalog_improvement_context (organization_id, store_id)
select organization_id, store_id
from public.bootstrap_organization('Catalog Improvement Retail', 'Catalog Main', 'Catalog Counter');

update catalog_improvement_context
set register_id = (
  select register.id
  from public.registers register
  where register.organization_id = catalog_improvement_context.organization_id
    and register.store_id = catalog_improvement_context.store_id
  order by register.created_at
  limit 1
);

update catalog_improvement_context
set component_product_id = public.create_catalog_product_v2(
  organization_id, null, 'Recipe Sauce', '', 'simple', 'SAUCE-1', '480000002421',
  100, 20, true, 'kg', array[store_id], '[]'::jsonb, '', false, true
);

update catalog_improvement_context
set parent_product_id = public.create_catalog_product_v2(
  organization_id, null, 'Burger Meal', '', 'composite', 'BURGER-1', '480000002422',
  25000, 5000, true, 'each', array[store_id], '[]'::jsonb, '', false, false
);

update catalog_improvement_context
set variable_product_id = public.create_catalog_product_v2(
  organization_id, null, 'Market price item', '', 'simple', 'MARKET-1', '480000002423',
  0, 0, false, 'each', array[store_id], '[]'::jsonb, '', true, false
);

update catalog_improvement_context
set actor_employee_id = (select id from public.employees where organization_id = catalog_improvement_context.organization_id);

select is((select product_type from public.products where id = (select parent_product_id from catalog_improvement_context)), 'simple', 'composites preserve the existing simple checkout contract');
select ok((select is_composite from public.products where id = (select parent_product_id from catalog_improvement_context)), 'composite flag marks the recipe parent');
select is((select count(*) from public.product_units where product_id in ((select parent_product_id from catalog_improvement_context), (select component_product_id from catalog_improvement_context)) and is_base), 2::bigint, 'every product receives one base unit');

insert into public.product_units (organization_id, product_id, unit_code, unit_name, factor_to_base, is_sale_unit, is_purchase_unit)
select organization_id, component_product_id, 'gram', 'Gram', 0.001, true, true
from catalog_improvement_context;
select is((select factor_to_base from public.product_units where product_id = (select component_product_id from catalog_improvement_context) and unit_code = 'gram'), 0.001::numeric, 'exact gram-to-kilogram conversion is stored');

insert into public.product_components (organization_id, product_id, component_product_id, quantity_per_composite)
select organization_id, parent_product_id, component_product_id, 0.025
from catalog_improvement_context;
select is((select quantity_per_composite from public.product_components where product_id = (select parent_product_id from catalog_improvement_context)), 0.025::numeric, 'composite recipe stores exact component quantity');

reset role;

update public.inventory_levels set quantity = 10
where store_id = (select store_id from catalog_improvement_context)
  and product_id in ((select parent_product_id from catalog_improvement_context), (select component_product_id from catalog_improvement_context));

insert into public.inventory_movements (
  organization_id, store_id, product_id, quantity_delta, quantity_before, quantity_after,
  movement_type, actor_employee_id, reason, source_type, source_id
)
select organization_id, store_id, parent_product_id, -1, 10, 9, 'SALE', actor_employee_id, 'POS checkout', 'sale', gen_random_uuid()
from catalog_improvement_context;

select is((select quantity from public.inventory_levels where store_id = (select store_id from catalog_improvement_context) and product_id = (select component_product_id from catalog_improvement_context)), 9.975::numeric, 'composite sale updates component stock in the projection');
select is((select quantity_delta from public.inventory_movements where source_type = 'composite_sale' order by created_at desc limit 1), (-0.025)::numeric, 'composite sale appends an auditable component ledger row');

set local role authenticated;
set local request.jwt.claim.sub = '24242424-2424-4424-8424-242424242424';

select ok(to_regprocedure('public.import_catalog_products_v2(uuid,uuid[],jsonb)') is not null, 'atomic catalog CSV import function exists');
select is(
  public.import_catalog_products_v2(
    (select organization_id from catalog_improvement_context),
    array[(select store_id from catalog_improvement_context)],
    jsonb_build_array(jsonb_build_object(
      'row_number', 2, 'name', 'Imported product', 'description', '', 'category_id', null,
      'sku', 'IMPORT-OK', 'barcode', '480000002499', 'price_minor', 12500,
      'cost_minor', 5000, 'track_inventory', true, 'unit', 'each', 'image_url', '',
      'is_variable_price', false, 'allow_fractional_quantity', false,
      'price_override_minor', null, 'low_stock_level', null
    ))
  ),
  1,
  'a validated CSV batch imports every row'
);
select is((select count(*) from public.products where sku = 'IMPORT-OK'), 1::bigint, 'the validated CSV product was created');
select throws_ok(
  $$
    select public.import_catalog_products_v2(
      (select organization_id from catalog_improvement_context),
      array[(select store_id from catalog_improvement_context)],
      jsonb_build_array(
        jsonb_build_object(
          'row_number', 2, 'name', 'Rollback first row', 'description', '', 'category_id', null,
          'sku', 'ROLLBACK-ONE', 'barcode', '480000002497', 'price_minor', 12500,
          'cost_minor', 0, 'track_inventory', false, 'unit', 'each', 'image_url', '',
          'is_variable_price', false, 'allow_fractional_quantity', false,
          'price_override_minor', null, 'low_stock_level', null
        ),
        jsonb_build_object(
          'row_number', 3, 'name', 'Rollback duplicate row', 'description', '', 'category_id', null,
          'sku', 'IMPORT-OK', 'barcode', '480000002496', 'price_minor', 12500,
          'cost_minor', 0, 'track_inventory', false, 'unit', 'each', 'image_url', '',
          'is_variable_price', false, 'allow_fractional_quantity', false,
          'price_override_minor', null, 'low_stock_level', null
        )
      )
    );
  $$,
  '23505',
  'SKU and barcode values must identify one saleable item.',
  'an invalid CSV batch raises an error'
);
select is((select count(*) from public.products where sku = 'ROLLBACK-ONE'), 0::bigint, 'a failed CSV batch leaves no partial product behind');

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, 'Catalog improvement opening float')$$,
    (select organization_id from catalog_improvement_context),
    (select store_id from catalog_improvement_context),
    (select register_id from catalog_improvement_context)
  ),
  'an open shift permits the extended POS checkout'
);

select is(
  (
    select total_minor
    from public.checkout_advanced_sale(
      (select organization_id from catalog_improvement_context),
      (select store_id from catalog_improvement_context),
      (select register_id from catalog_improvement_context),
      '25252525-2525-4525-8525-252525252525',
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select component_product_id from catalog_improvement_context),
          'variant_id', null,
          'quantity', 0.025,
          'unit_price_minor', null,
          'modifier_option_ids', '[]'::jsonb
        ),
        jsonb_build_object(
          'product_id', (select variable_product_id from catalog_improvement_context),
          'variant_id', null,
          'quantity', 1,
          'unit_price_minor', 12345,
          'modifier_option_ids', '[]'::jsonb
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'payment_method_id', (
          select method.id
          from public.payment_methods method
          join public.store_payment_methods store_method
            on store_method.organization_id = method.organization_id
           and store_method.payment_method_id = method.id
           and store_method.store_id = (select store_id from catalog_improvement_context)
           and store_method.is_enabled
          where method.organization_id = (select organization_id from catalog_improvement_context)
            and method.payment_type = 'CASH'
            and method.is_enabled
          limit 1
        ),
        'amount_tendered_minor', 20000
      )),
      null, 0, null, null, null, null
    )
  ),
  12348::bigint,
  'variable and fractional catalogue checkout uses the server-approved manual price'
);
select is(
  (
    select quantity
    from public.sale_items item
    join public.sales sale on sale.id = item.sale_id
    where sale.organization_id = (select organization_id from catalog_improvement_context)
      and item.product_id = (select component_product_id from catalog_improvement_context)
    order by item.created_at desc
    limit 1
  ),
  0.025::numeric,
  'sale item snapshots retain the exact fractional quantity'
);
select is(
  (
    select unit_price_minor
    from public.sale_items item
    join public.sales sale on sale.id = item.sale_id
    where sale.organization_id = (select organization_id from catalog_improvement_context)
      and item.product_id = (select variable_product_id from catalog_improvement_context)
    order by item.created_at desc
    limit 1
  ),
  12345::bigint,
  'sale item snapshots retain the approved manual price'
);
select is(
  (
    select quantity
    from public.inventory_levels
    where store_id = (select store_id from catalog_improvement_context)
      and product_id = (select component_product_id from catalog_improvement_context)
  ),
  9.95::numeric,
  'fractional checkout appends the matching stock deduction'
);
select throws_ok(
  $$
    select public.checkout_advanced_sale(
      (select organization_id from catalog_improvement_context),
      (select store_id from catalog_improvement_context),
      (select register_id from catalog_improvement_context),
      '26262626-2626-4626-8626-262626262626',
      jsonb_build_array(jsonb_build_object(
        'product_id', (select parent_product_id from catalog_improvement_context),
        'variant_id', null,
        'quantity', 0.025,
        'unit_price_minor', null,
        'modifier_option_ids', '[]'::jsonb
      )),
      jsonb_build_array(jsonb_build_object(
        'payment_method_id', (
          select method.id from public.payment_methods method
          join public.store_payment_methods store_method on store_method.organization_id = method.organization_id and store_method.payment_method_id = method.id and store_method.store_id = (select store_id from catalog_improvement_context) and store_method.is_enabled
          where method.organization_id = (select organization_id from catalog_improvement_context) and method.payment_type = 'CASH' and method.is_enabled limit 1
        ),
        'amount_tendered_minor', 100
      )),
      null, 0, null, null, null, null
    );
  $$,
  '23514',
  'This product must be sold in whole units.',
  'a product without fractional configuration rejects a fractional sale'
);

select * from finish();
rollback;
