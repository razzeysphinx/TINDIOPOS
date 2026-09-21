begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_column(
  'public',
  'purchase_order_lines',
  'purchase_unit_code_snapshot',
  'purchase-order lines retain immutable purchase-unit code snapshots'
);

select has_column(
  'public',
  'purchase_order_lines',
  'purchase_unit_factor_to_base',
  'purchase-order lines retain immutable purchase-unit conversion snapshots'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.purchase_order_lines',
    'purchase_unit_code_snapshot',
    'SELECT'
  ),
  'authenticated purchasing readers can read purchase-unit code snapshots'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.purchase_order_lines',
    'purchase_unit_factor_to_base',
    'SELECT'
  ),
  'authenticated purchasing readers can read purchase-unit conversion snapshots'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.purchase_order_lines',
    'unit_cost_minor',
    'SELECT'
  ),
  'raw purchase-order unit cost remains unavailable through direct authenticated table reads'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.purchase_order_lines',
    'SELECT'
  ),
  'authenticated still has no whole-table SELECT privilege on purchase-order lines'
);

select ok(
  exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'purchase_order_lines'
      and policy.policyname = 'purchase_order_lines_select_purchasing_scope'
  ),
  'purchase-order line reads remain protected by the purchasing-scope RLS policy'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_purchase_order_line_costs(uuid,uuid[])',
    'EXECUTE'
  ),
  'authenticated callers retain the permission-checked purchase-order cost RPC'
);

select ok(
  pg_get_functiondef(
    'public.get_purchase_order_line_costs(uuid,uuid[])'::regprocedure
  ) like '%products.view_cost%',
  'purchase-order cost RPC still requires products.view_cost'
);

select ok(
  pg_get_functiondef(
    'public.get_purchase_order_line_costs(uuid,uuid[])'::regprocedure
  ) like '%has_store_read_scope%',
  'purchase-order cost RPC remains assigned-store scoped'
);

select * from finish();

rollback;
