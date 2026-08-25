begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_table('public', 'categories', 'categories table exists');
select has_table('public', 'products', 'products table exists');
select has_table('public', 'product_variants', 'product_variants table exists');
select has_table(
  'public',
  'product_store_settings',
  'product_store_settings table exists'
);
select has_table('public', 'inventory_levels', 'inventory_levels table exists');
select has_table(
  'public',
  'inventory_movements',
  'inventory_movements table exists'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'categories', 'products', 'product_variants',
        'product_store_settings', 'inventory_levels', 'inventory_movements'
      )
      and relation.relrowsecurity
  ),
  6::bigint,
  'RLS is enabled on every Phase 2 table'
);

select ok(
  has_column_privilege('authenticated', 'public.products', 'price_minor', 'select'),
  'authenticated catalogue readers can select selling price'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.products',
    'cost_minor',
    'select'
  ),
  'product cost is not directly selectable by authenticated callers'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_levels', 'insert'),
  'authenticated callers cannot insert stock projections directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_levels', 'update'),
  'authenticated callers cannot update stock projections directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_movements', 'insert'),
  'authenticated callers cannot append arbitrary inventory movements'
);
select ok(
  to_regprocedure(
    'public.create_catalog_product(uuid,uuid,text,text,text,text,text,bigint,bigint,boolean,text,uuid[],jsonb)'
  ) is not null,
  'atomic catalogue product routine exists'
);
select ok(
  to_regprocedure(
    'public.adjust_inventory(uuid,uuid,uuid,uuid,numeric,text,text,uuid)'
  ) is not null,
  'atomic inventory adjustment routine exists'
);

select * from finish();
rollback;
