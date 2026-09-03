begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(
  to_regprocedure('public.get_pos_receipt_history(uuid,text,bigint,integer)') is not null,
  'compact POS receipt history projection exists'
);
select ok(
  to_regprocedure('public.get_pos_receipt_detail(uuid,uuid)') is not null,
  'canonical POS receipt detail projection exists'
);
select ok(
  to_regprocedure('public.decide_manager_approval(uuid,uuid,text)') is not null,
  'remote manager decision routine exists'
);
select ok(
  not has_function_privilege('anon', 'public.decide_manager_approval(uuid,uuid,text)', 'execute'),
  'anonymous callers cannot decide approval requests'
);
select ok(
  has_function_privilege('authenticated', 'public.decide_manager_approval(uuid,uuid,text)', 'execute'),
  'authenticated employees can reach the authorized decision boundary'
);
select ok(
  not has_function_privilege('anon', 'public.get_pos_receipt_history(uuid,text,bigint,integer)', 'execute'),
  'anonymous callers cannot read POS receipt history'
);
select ok(
  has_function_privilege('authenticated', 'public.get_pos_receipt_history(uuid,text,bigint,integer)', 'execute'),
  'authenticated employees can reach the authorized receipt projection'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.approval_requests'::regclass
      and trigger_row.tgname = 'approval_requests_validate_refund'
      and not trigger_row.tgisinternal
  ),
  'refund approval payload validation runs at the database boundary'
);
select ok(
  pg_get_functiondef('public.get_pos_receipt_history(uuid,text,bigint,integer)'::regprocedure)
    like '%normalized_query ~ ''^#?[0-9]+$''%',
  'receipt lookup normalizes human receipt references'
);
select ok(
  pg_get_functiondef('public.get_pos_receipt_history(uuid,text,bigint,integer)'::regprocedure)
    like '%payment_methods jsonb%',
  'receipt history returns compact payment method snapshots'
);
select ok(
  pg_get_functiondef('public.queue_receipt_delivery(uuid,uuid,text,text,uuid)'::regprocedure)
    like '%private.has_sale_read_scope%',
  'digital receipt delivery checks authoritative sale scope'
);
select ok(
  pg_get_functiondef('private.decide_manager_approval(uuid,uuid,text)'::regprocedure)
    like '%APPROVAL_REJECTED%',
  'remote approval rejection writes an audit event'
);

select * from finish();
rollback;
