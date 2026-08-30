begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_counts'
      and policyname = 'inventory_counts_select_authorized_scope'
      and qual like '%has_store_read_scope%'
  ),
  'inventory count headers require the authorized store scope'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_count_lines'
      and policyname = 'inventory_count_lines_select_authorized_scope'
      and qual like '%inventory_counts%'
      and qual like '%has_store_read_scope%'
  ),
  'inventory count lines inherit their header store scope'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('inventory_counts', 'inventory_count_lines')
      and policyname in ('inventory_counts_select_inventory_manager', 'inventory_count_lines_select_inventory_manager')
  ),
  'legacy organization-wide count read policies are removed'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('inventory_counts', 'inventory_count_lines')),
  2::bigint,
  'count history exposes only the two scoped read policies'
);

select * from finish();

rollback;
