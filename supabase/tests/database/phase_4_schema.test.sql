begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('public', 'sales', 'sales table exists');
select has_table('public', 'sale_items', 'sale_items table exists');
select has_table('public', 'payments', 'payments table exists');
select has_table('public', 'receipts', 'receipts table exists');
select has_table('public', 'checkout_requests', 'checkout_requests table exists');
select has_table('public', 'payment_methods', 'payment methods table exists');
select has_table('public', 'store_payment_methods', 'store payment methods table exists');

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'sales', 'sale_items', 'payments', 'receipts', 'checkout_requests',
        'payment_methods', 'store_payment_methods'
      )
      and relation.relrowsecurity
  ),
  7::bigint,
  'RLS is enabled on every Phase 4 table'
);

select ok(
  pg_get_constraintdef(
    (
      select constraint_row.oid
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conname = 'inventory_movements_type_values'
        and constraint_row.conrelid = 'public.inventory_movements'::regclass
    )
  ) like '%SALE%',
  'inventory movements accept the SALE ledger type'
);

select ok(
  not has_table_privilege('authenticated', 'public.sales', 'insert'),
  'authenticated callers cannot insert sales directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.sale_items', 'insert'),
  'authenticated callers cannot insert sale items directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.payments', 'insert'),
  'authenticated callers cannot insert payments directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.receipts', 'insert'),
  'authenticated callers cannot issue receipts directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.checkout_requests', 'select'),
  'idempotency request records are not directly readable'
);

select ok(
  to_regprocedure('public.checkout_cash_sale(uuid,uuid,uuid,bigint,uuid,jsonb)')
    is not null,
  'atomic cash checkout routine exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.checkout_cash_sale(uuid,uuid,uuid,bigint,uuid,jsonb)',
    'execute'
  ),
  'anonymous callers cannot execute cash checkout'
);
select ok(
  to_regprocedure('public.checkout_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)') is not null,
  'atomic multi-payment checkout routine exists'
);
select ok(
  not has_table_privilege('authenticated', 'public.payments', 'update'),
  'authenticated callers cannot alter completed payment records directly'
);

select * from finish();
rollback;
