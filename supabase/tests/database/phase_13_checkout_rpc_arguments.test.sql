begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(
  to_regprocedure('public.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)') is not null,
  'advanced checkout RPC wrapper exists'
);

select is(
  (
    select array_to_string(routine.proargnames[1:12], ',')
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname = 'checkout_advanced_sale'
  ),
  'target_organization_id,target_store_id,target_register_id,target_idempotency_key,target_items,target_payments,target_customer_id,target_loyalty_redemption_points,target_discount_id,target_tax_rate_id,target_dining_option_id,target_open_ticket_id',
  'advanced checkout RPC exposes PostgREST argument names'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'authenticated users can execute the advanced checkout RPC'
);

select * from finish();

rollback;
