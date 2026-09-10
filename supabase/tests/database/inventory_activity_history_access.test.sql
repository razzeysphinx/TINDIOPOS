begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

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
      and qual like '%inventory.adjust%'
      and qual like '%inventory.count%'
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
      and qual like '%inventory.adjust%'
      and qual like '%inventory.count%'
      and qual like '%has_store_read_scope%'
  ),
  'the stock projection read policy agrees with the activity workspace capability model'
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

select * from finish();

rollback;
