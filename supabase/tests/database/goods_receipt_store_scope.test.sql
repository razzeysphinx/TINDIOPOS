begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'goods_receipts'
      and policyname = 'goods_receipts_select_authorized_scope'
      and qual like '%has_store_read_scope%'
  ),
  'goods receipt headers require the authorized store scope'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'goods_receipt_lines'
      and policyname = 'goods_receipt_lines_select_authorized_scope'
      and qual like '%goods_receipts%'
      and qual like '%has_store_read_scope%'
  ),
  'goods receipt lines inherit their receipt store scope'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('goods_receipts', 'goods_receipt_lines')
      and policyname in ('goods_receipts_select_inventory_manager', 'goods_receipt_lines_select_inventory_manager')
  ),
  'legacy organization-wide goods receipt read policies are removed'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('goods_receipts', 'goods_receipt_lines')),
  2::bigint,
  'receiving history exposes only the two scoped read policies'
);

select * from finish();

rollback;
