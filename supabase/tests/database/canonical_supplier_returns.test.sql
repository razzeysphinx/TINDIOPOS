begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select has_table('public', 'supplier_returns', 'supplier-return headers exist');
select has_table('public', 'supplier_return_lines', 'supplier-return lines exist');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_returns'::regclass), 'header RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_return_lines'::regclass), 'line RLS is enabled');
select has_column('public', 'supplier_returns', 'operation_id', 'header stores the operation identifier');
select has_column('public', 'supplier_return_lines', 'unit_cost_minor', 'line stores the valuation snapshot');
select ok(to_regprocedure('public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)') is not null, 'canonical public command exists');
select ok(to_regprocedure('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)') is not null, 'private mutation engine exists');
select ok(to_regprocedure('public.return_to_supplier(uuid,uuid,uuid,jsonb,text)') is null, 'legacy public overload is removed');
select ok(to_regprocedure('private.return_to_supplier(uuid,uuid,uuid,jsonb,text)') is null, 'legacy private overload is removed');
select is(
  (select prosecdef from pg_proc where oid = 'public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure),
  true,
  'public command is security definer'
);
select is(
  (select proconfig from pg_proc where oid = 'public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure),
  array['search_path=""'],
  'public command has an empty search path'
);
select ok(has_function_privilege('authenticated', 'public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)', 'execute'), 'authenticated may execute the public command');
select ok(not has_function_privilege('anon', 'public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)', 'execute'), 'anonymous may not execute the public command');
select ok(not has_function_privilege('service_role', 'public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)', 'execute'), 'service role receives no new command grant');
select ok(not has_function_privilege('authenticated', 'private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)', 'execute'), 'authenticated cannot execute the private engine');
select ok(not has_function_privilege('service_role', 'private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)', 'execute'), 'service role cannot execute the private engine');
select ok(
  pg_get_functiondef('public.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%pg_advisory_xact_lock%',
  'public command serializes each organization operation key'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%persisted_lines is distinct from normalized_lines%',
  'replay validates the complete normalized line payload'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%purchasing.return%',
  'canonical purchasing-return capability is enforced'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%inventory.manage%',
  'legacy inventory-manager compatibility remains explicit'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%supplier.is_active%',
  'supplier must be active in the organization'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%inventory_actor%',
  'actor must be assigned to the target store'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%Stock is insufficient%',
  'negative stock is rejected'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%stock_level.average_cost_minor%',
  'line and movement valuation use the current weighted cost'
);
select trigger_is('public', 'supplier_returns', 'supplier_returns_guard_immutable', 'private', 'guard_supplier_return_evidence', 'header evidence is immutable');
select trigger_is('public', 'supplier_return_lines', 'supplier_return_lines_guard_immutable', 'private', 'guard_supplier_return_evidence', 'line evidence is immutable');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'supplier_returns'
      and indexdef like '%UNIQUE%' and indexdef like '%organization_id%' and indexdef like '%operation_id%'
  ),
  'organization operation identifiers are unique'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%SUPPLIER_RETURN_CREATED%'
  and pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) like '%purchasing.return%',
  'posting emits canonical audit evidence'
);
select ok(
  pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) not like '%update public.purchase_order_lines%'
  and pg_get_functiondef('private.return_to_supplier(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure) not like '%update public.goods_receipt_lines%',
  'supplier returns remain independent of purchasing receipt lifecycle state'
);

select * from finish();
rollback;
