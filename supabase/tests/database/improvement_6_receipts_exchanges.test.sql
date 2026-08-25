begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

select has_table('public', 'receipt_settings', 'receipt settings table exists');
select has_table('public', 'receipt_delivery_requests', 'digital receipt outbox table exists');
select has_table('public', 'sale_exchanges', 'sale exchanges table exists');
select ok(
  to_regprocedure('public.update_receipt_settings(uuid,text,text,text,text,text,text,text,text,smallint,boolean,boolean,boolean,boolean,boolean)') is not null,
  'receipt settings RPC exists'
);
select ok(
  to_regprocedure('public.queue_receipt_delivery(uuid,uuid,text,text,uuid)') is not null,
  'digital receipt queue RPC exists'
);
select ok(
  to_regprocedure('public.link_sale_exchange(uuid,uuid,bigint,uuid)') is not null,
  'exchange-link RPC exists'
);
select ok(
  to_regprocedure('public.update_receipt_delivery_status(uuid,text,text,text)') is not null,
  'service-only delivery worker RPC exists'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('receipt_settings', 'receipt_delivery_requests', 'sale_exchanges')
      and relation.relrowsecurity
  ),
  3::bigint,
  'RLS is enabled on every Improvement 6 table'
);
select ok(
  not has_table_privilege('authenticated', 'public.receipt_settings', 'update'),
  'authenticated callers cannot update receipt settings directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.receipt_delivery_requests', 'insert'),
  'authenticated callers cannot insert delivery requests directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.sale_exchanges', 'insert'),
  'authenticated callers cannot insert exchange links directly'
);
select ok(
  not has_function_privilege('anon', 'public.queue_receipt_delivery(uuid,uuid,text,text,uuid)', 'execute'),
  'anonymous callers cannot queue receipt delivery'
);
select ok(
  not has_function_privilege('anon', 'public.link_sale_exchange(uuid,uuid,bigint,uuid)', 'execute'),
  'anonymous callers cannot link exchanges'
);
select ok(
  not has_function_privilege('authenticated', 'public.update_receipt_delivery_status(uuid,text,text,text)', 'execute'),
  'browser callers cannot update delivery status'
);
select ok(
  has_function_privilege('service_role', 'public.update_receipt_delivery_status(uuid,text,text,text)', 'execute'),
  'only the delivery worker role can update delivery status'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '61616161-6161-4614-8614-616161616161',
    'improvement-six-owner@tindio.test',
    '{"full_name":"Improvement Six Owner"}'::jsonb
  ),
  (
    '62626262-6262-4624-8624-626262626262',
    'improvement-six-other@tindio.test',
    '{"full_name":"Improvement Six Other"}'::jsonb
  );

create temporary table improvement_six_context (
  label text primary key,
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  product_id uuid,
  original_sale_id uuid,
  original_receipt_id uuid,
  original_receipt_number bigint,
  refund_id uuid,
  replacement_sale_id uuid,
  replacement_receipt_number bigint
);

grant select, insert, update on table improvement_six_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '61616161-6161-4614-8614-616161616161';

insert into improvement_six_context (label, organization_id, store_id, register_id)
select 'primary', organization_id, store_id, register_id
from public.bootstrap_organization(
  'Improvement Six Retail',
  'Improvement Six Main',
  'Improvement Six Counter'
);

select is(
  (select business_name from public.receipt_settings where organization_id = (select organization_id from improvement_six_context where label = 'primary')),
  'Improvement Six Retail',
  'receipt settings seed from the organization name'
);

select is(
  public.update_receipt_settings(
    (select organization_id from improvement_six_context where label = 'primary'),
    'Improvement Six Legal',
    '100 Tindio Avenue',
    '+63 2 555 0100',
    'receipt@improvement-six.test',
    'TIN-IMPROVEMENT-6',
    'https://tindio.test',
    'Thank you for shopping local',
    'Please come again.',
    58::smallint,
    true,
    true,
    true,
    true,
    true
  ),
  true,
  'settings manager can save receipt configuration through the RPC'
);

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'Improvement Six Category', 1
  from improvement_six_context
  where label = 'primary'
  returning id
)
update improvement_six_context
set category_id = (select id from inserted_category)
where label = 'primary';

update improvement_six_context
set product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Improvement Six Item',
  'Receipt and exchange test item',
  'simple',
  'IMPROVEMENT-SIX-ITEM',
  '480000060010',
  1000,
  0,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
)
where label = 'primary';

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 1000, 'Improvement Six opening float')$$,
    (select organization_id from improvement_six_context where label = 'primary'),
    (select store_id from improvement_six_context where label = 'primary'),
    (select register_id from improvement_six_context where label = 'primary')
  ),
  'owner can open a shift before issuing receipt snapshots'
);

update improvement_six_context context
set
  original_sale_id = checkout.sale_id,
  original_receipt_number = checkout.receipt_number
from public.checkout_sale(
  (select organization_id from improvement_six_context where label = 'primary'),
  (select store_id from improvement_six_context where label = 'primary'),
  (select register_id from improvement_six_context where label = 'primary'),
  '63636363-6363-4634-8634-636363636363',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from improvement_six_context where label = 'primary'),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (
      select id
      from public.payment_methods
      where organization_id = (select organization_id from improvement_six_context where label = 'primary')
        and code = 'CASH'
    ),
    'amount_tendered_minor', 1000
  ))
) checkout
where context.label = 'primary';

update improvement_six_context
set original_receipt_id = (
  select receipt.id
  from public.receipts receipt
  where receipt.organization_id = improvement_six_context.organization_id
    and receipt.sale_id = improvement_six_context.original_sale_id
)
where label = 'primary';

select is(
  (
    select receipt_layout_snapshot ->> 'business_name'
    from public.receipts
    where id = (select original_receipt_id from improvement_six_context where label = 'primary')
  ),
  'Improvement Six Legal',
  'new receipt captures the configured business name as an immutable snapshot'
);
select is(
  (
    select (receipt_layout_snapshot ->> 'paper_width_mm')::integer
    from public.receipts
    where id = (select original_receipt_id from improvement_six_context where label = 'primary')
  ),
  58,
  'new receipt captures its configured paper width'
);

select is(
  public.update_receipt_settings(
    (select organization_id from improvement_six_context where label = 'primary'),
    'Changed Future Layout', '', '', '', '', '', '', 'Changed future footer.', 80::smallint,
    false, false, false, false, false
  ),
  true,
  'settings can change for future receipts'
);
select is(
  (
    select receipt_layout_snapshot ->> 'business_name'
    from public.receipts
    where id = (select original_receipt_id from improvement_six_context where label = 'primary')
  ),
  'Improvement Six Legal',
  'changing settings does not rewrite the existing receipt snapshot'
);

select is(
  (
    select delivery_status
    from public.queue_receipt_delivery(
      (select organization_id from improvement_six_context where label = 'primary'),
      (select original_receipt_id from improvement_six_context where label = 'primary'),
      'EMAIL',
      'customer@improvement-six.test',
      '64646464-6464-4644-8644-646464646464'
    )
  ),
  'QUEUED',
  'digital receipt request enters the provider-ready queue'
);
select ok(
  (
    select was_replayed
    from public.queue_receipt_delivery(
      (select organization_id from improvement_six_context where label = 'primary'),
      (select original_receipt_id from improvement_six_context where label = 'primary'),
      'EMAIL',
      'customer@improvement-six.test',
      '64646464-6464-4644-8644-646464646464'
    )
  ),
  'replaying a digital receipt request returns the existing queue record'
);
select is(
  (
    select count(*)
    from public.audit_logs
    where organization_id = (select organization_id from improvement_six_context where label = 'primary')
      and event_type = 'RECEIPT_DELIVERY_QUEUED'
  ),
  1::bigint,
  'queueing a digital receipt creates an audit record'
);

update improvement_six_context context
set refund_id = refund.refund_id
from public.refund_sale(
  (select organization_id from improvement_six_context where label = 'primary'),
  (select original_sale_id from improvement_six_context where label = 'primary'),
  (
    select id
    from public.payment_methods
    where organization_id = (select organization_id from improvement_six_context where label = 'primary')
      and code = 'CASH'
  ),
  '65656565-6565-4654-8654-656565656565',
  'Customer exchanged the item',
  null,
  jsonb_build_array(jsonb_build_object(
    'sale_item_id', (
      select item.id
      from public.sale_items item
      where item.sale_id = (select original_sale_id from improvement_six_context where label = 'primary')
    ),
    'quantity', 1
  ))
) refund
where context.label = 'primary';

update improvement_six_context context
set
  replacement_sale_id = checkout.sale_id,
  replacement_receipt_number = checkout.receipt_number
from public.checkout_sale(
  (select organization_id from improvement_six_context where label = 'primary'),
  (select store_id from improvement_six_context where label = 'primary'),
  (select register_id from improvement_six_context where label = 'primary'),
  '66666666-6666-4664-8664-666666666666',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from improvement_six_context where label = 'primary'),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id', (
      select id
      from public.payment_methods
      where organization_id = (select organization_id from improvement_six_context where label = 'primary')
        and code = 'CASH'
    ),
    'amount_tendered_minor', 1000
  ))
) checkout
where context.label = 'primary';

select is(
  (
    select replacement_receipt_number
    from public.link_sale_exchange(
      (select organization_id from improvement_six_context where label = 'primary'),
      (select refund_id from improvement_six_context where label = 'primary'),
      (select replacement_receipt_number from improvement_six_context where label = 'primary'),
      '67676767-6767-4674-8674-676767676767'
    )
  ),
  (select replacement_receipt_number from improvement_six_context where label = 'primary'),
  'exchange link records the completed return and separate replacement receipt'
);
select is(
  (
    select count(*)
    from public.sale_exchanges
    where organization_id = (select organization_id from improvement_six_context where label = 'primary')
  ),
  1::bigint,
  'exchange link creates exactly one immutable relationship record'
);
select is(
  (
    select count(*)
    from public.audit_logs
    where organization_id = (select organization_id from improvement_six_context where label = 'primary')
      and event_type = 'SALE_EXCHANGE_LINKED'
  ),
  1::bigint,
  'exchange link creates an audit record'
);
select is(
  (
    select status
    from public.sales
    where id = (select original_sale_id from improvement_six_context where label = 'primary')
  ),
  'completed',
  'original completed sale remains unchanged after the exchange'
);

select * from finish();
rollback;
