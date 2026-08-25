begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select ok(to_regclass('public.kitchen_station_category_routes') is not null, 'station category route table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.kitchen_station_category_routes'::regclass), 'station category routes have RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.kitchen_station_category_routes', 'select'), 'authenticated users cannot read station routes directly');
select ok(to_regclass('public.kitchen_order_items_station_queue_idx') is not null, 'station queue index exists');
select ok(to_regprocedure('public.update_kitchen_order_item_status(uuid,uuid,text)') is not null, 'item-level kitchen status routine exists');
select ok(to_regprocedure('public.set_kitchen_order_priority(uuid,uuid,text)') is not null, 'kitchen priority routine exists');
select ok(to_regprocedure('public.set_kitchen_station_category_route(uuid,uuid,text)') is not null, 'station routing routine exists');
select ok(to_regprocedure('public.get_customer_display_receipt(text,uuid)') is not null, 'digital receipt routine exists');
select ok(has_function_privilege('anon', 'public.get_customer_display_receipt(text,uuid)', 'execute'), 'paired display capability can access the digital receipt routine');

insert into auth.users (id, email, raw_user_meta_data)
values ('f1111111-1111-4111-8111-111111111111', 'phase-fifteen-owner@tindio.test', '{"full_name":"Phase Fifteen Owner"}'::jsonb);

create temporary table improvement_fifteen_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  category_id uuid,
  product_id uuid,
  dining_option_id uuid,
  sale_id uuid,
  kitchen_order_id uuid,
  kitchen_order_item_id uuid,
  display_session_id uuid,
  display_token_hash text not null default repeat('a', 64),
  display_topic text not null default repeat('A', 43)
);

grant select, insert, update on improvement_fifteen_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';

insert into improvement_fifteen_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization('Improvement Fifteen Cafe', 'Phase Fifteen Main', 'Phase Fifteen Counter');

select lives_ok(
  format(
    $$select public.open_register_shift(%L, %L, %L, 0, null)$$,
    (select organization_id from improvement_fifteen_context),
    (select store_id from improvement_fifteen_context),
    (select register_id from improvement_fifteen_context)
  ),
  'owner opens a shift before completing the dining sale'
);

with inserted_category as (
  insert into public.categories (organization_id, name, sort_order)
  select organization_id, 'Phase Fifteen Desserts', 1
  from improvement_fifteen_context
  returning id
)
update improvement_fifteen_context
set category_id = inserted_category.id
from inserted_category;

select lives_ok(
  format(
    $$select public.set_kitchen_station_category_route(%L, %L, 'DESSERT')$$,
    (select organization_id from improvement_fifteen_context),
    (select category_id from improvement_fifteen_context)
  ),
  'kitchen manager routes a category to the dessert station'
);

update improvement_fifteen_context
set product_id = public.create_catalog_product(
  organization_id,
  category_id,
  'Phase Fifteen Cake',
  'Kitchen and display fixture',
  'simple',
  'PHASE15-CAKE',
  '480000150001',
  25000,
  9000,
  false,
  'each',
  array[store_id],
  '[]'::jsonb
);

with inserted_option as (
  insert into public.dining_options (organization_id, name, is_default, sort_order)
  select organization_id, 'Dine in', true, 0
  from improvement_fifteen_context
  returning id
)
update improvement_fifteen_context
set dining_option_id = inserted_option.id
from inserted_option;

update improvement_fifteen_context context
set sale_id = (
  select sale_id
  from public.checkout_advanced_sale(
    context.organization_id,
    context.store_id,
    context.register_id,
    'f2222222-2222-4222-8222-222222222222',
    jsonb_build_array(jsonb_build_object(
      'product_id', context.product_id,
      'variant_id', null,
      'quantity', 1,
      'modifier_option_ids', '[]'::jsonb
    )),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', (
        select id from public.payment_methods
        where organization_id = context.organization_id and code = 'CASH'
      ),
      'amount_tendered_minor', 30000
    )),
    null,
    0,
    null,
    null,
    context.dining_option_id,
    null
  )
);

update improvement_fifteen_context context
set kitchen_order_id = (
  select kitchen_order_id
  from public.get_kitchen_orders(context.organization_id, context.store_id)
  where kitchen_order_id is not null
  limit 1
);

update improvement_fifteen_context context
set kitchen_order_item_id = (
  select (items -> 0 ->> 'id')::uuid
  from public.get_kitchen_orders(context.organization_id, context.store_id)
  where kitchen_order_id = context.kitchen_order_id
);

select is(
  (select items -> 0 ->> 'station' from public.get_kitchen_orders((select organization_id from improvement_fifteen_context), (select store_id from improvement_fifteen_context))),
  'DESSERT',
  'new sale snapshot routes the item to the configured dessert station'
);
select is(
  (select status from public.get_kitchen_orders((select organization_id from improvement_fifteen_context), (select store_id from improvement_fifteen_context))),
  'NEW',
  'newly routed kitchen order starts in NEW state'
);

select lives_ok(
  format(
    $$select public.set_kitchen_order_priority(%L, %L, 'RUSH')$$,
    (select organization_id from improvement_fifteen_context),
    (select kitchen_order_id from improvement_fifteen_context)
  ),
  'kitchen manager can mark an order as rush priority'
);
select is(
  (select priority from public.get_kitchen_orders((select organization_id from improvement_fifteen_context), (select store_id from improvement_fifteen_context))),
  'RUSH',
  'rush priority is persisted in the kitchen queue'
);

select lives_ok(
  format(
    $$select public.update_kitchen_order_item_status(%L, %L, 'PREPARING')$$,
    (select organization_id from improvement_fifteen_context),
    (select kitchen_order_item_id from improvement_fifteen_context)
  ),
  'kitchen manager can start one item'
);
select is(
  (select status from public.get_kitchen_orders((select organization_id from improvement_fifteen_context), (select store_id from improvement_fifteen_context))),
  'PREPARING',
  'item start recalculates the parent order as preparing'
);
select lives_ok(
  format(
    $$select public.update_kitchen_order_item_status(%L, %L, 'READY')$$,
    (select organization_id from improvement_fifteen_context),
    (select kitchen_order_item_id from improvement_fifteen_context)
  ),
  'kitchen manager can mark one item ready'
);
select is(
  (select status from public.get_kitchen_orders((select organization_id from improvement_fifteen_context), (select store_id from improvement_fifteen_context))),
  'READY',
  'all ready items recalculate the parent order as ready'
);
select lives_ok(
  format(
    $$select public.update_kitchen_order_item_status(%L, %L, 'COMPLETED')$$,
    (select organization_id from improvement_fifteen_context),
    (select kitchen_order_item_id from improvement_fifteen_context)
  ),
  'kitchen manager can complete one item'
);
select is(
  (select status from public.get_kitchen_orders((select organization_id from improvement_fifteen_context), (select store_id from improvement_fifteen_context))),
  'COMPLETED',
  'all completed items recalculate the parent order as completed'
);

update improvement_fifteen_context context
set display_session_id = (
  select session_id
  from public.provision_customer_display_session(
    context.organization_id,
    context.register_id,
    context.display_token_hash,
    context.display_topic
  )
);

select lives_ok(
  format(
    $$select public.set_customer_display_state(%L, %L, %L::jsonb)$$,
    (select organization_id from improvement_fifteen_context),
    (select display_session_id from improvement_fifteen_context),
    jsonb_build_object(
      'status', 'complete',
      'saleId', (select sale_id::text from improvement_fifteen_context),
      'items', jsonb_build_array(),
      'subtotalMinor', 25000,
      'discountMinor', 0,
      'taxMinor', 0,
      'totalMinor', 25000,
      'changeMinor', 5000,
      'payments', jsonb_build_array(),
      'updatedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  ),
  'paired POS can record the completed sale capability for its display'
);
select is(
  public.get_customer_display_receipt(
    (select display_token_hash from improvement_fifteen_context),
    (select sale_id from improvement_fifteen_context)
  ) ->> 'receipt_number',
  (select receipt_number::text from public.receipts where sale_id = (select sale_id from improvement_fifteen_context)),
  'paired display can retrieve only its current sale digital receipt'
);

create or replace function pg_temp.unpaired_digital_receipt_is_rejected() returns boolean language plpgsql as $$
begin
  perform public.get_customer_display_receipt(
    (select display_token_hash from improvement_fifteen_context),
    'f3333333-3333-4333-8333-333333333333'
  );
  return false;
exception when no_data_found then
  return true;
end;
$$;

select ok(pg_temp.unpaired_digital_receipt_is_rejected(), 'display capability cannot retrieve a receipt for a different sale');

select * from finish();
rollback;
