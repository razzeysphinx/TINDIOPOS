begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '90909090-9090-4090-8090-909090909090',
  'mto-checkout-owner@tindio.test',
  '{"full_name":"MTO Checkout Owner"}'::jsonb
);

create temporary table mto_checkout_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  component_product_id uuid,
  composite_product_id uuid
);

create temporary table mto_checkout_results (
  label text primary key,
  sale_id uuid not null,
  was_replayed boolean not null
);

grant select, insert, update
on mto_checkout_context, mto_checkout_results
to authenticated;

set local role authenticated;
set local request.jwt.claim.sub =
  '90909090-9090-4090-8090-909090909090';

insert into mto_checkout_context (
  organization_id, store_id, register_id
)
select organization_id, store_id, register_id
from public.bootstrap_organization(
  'MTO Checkout Test',
  'MTO Main',
  'MTO Counter'
);

update mto_checkout_context
set component_product_id =
  public.create_catalog_product_v3(
    organization_id, null,
    'MTO tracked component', '',
    'simple', 'MTO-COMPONENT', '480000909001',
    500, 200, true, 'each',
    array[store_id], '[]'::jsonb,
    '', false, false, 'made_to_order'
  );

update mto_checkout_context
set composite_product_id =
  public.create_catalog_product_v3(
    organization_id, null,
    'MTO finished composite', '',
    'composite', 'MTO-COMPOSITE', '480000909002',
    1000, 0, true, 'each',
    array[store_id], '[]'::jsonb,
    '', false, false, 'made_to_order'
  );

reset role;

insert into public.inventory_adjustment_reasons (
  organization_id,
  code,
  name,
  movement_type
)
select
  organization_id,
  'INITIAL',
  'Opening stock',
  'OPENING_STOCK'
from mto_checkout_context;

insert into public.product_components (
  organization_id,
  product_id,
  component_product_id,
  component_variant_id,
  quantity_per_composite
)
select
  organization_id,
  composite_product_id,
  component_product_id,
  null,
  3
from mto_checkout_context;

set local role authenticated;
set local request.jwt.claim.sub =
  '90909090-9090-4090-8090-909090909090';

select lives_ok(
  format(
    $$select public.record_inventory_adjustment_v3(
      %L,%L,%L,5,'INITIAL',
      'MTO component opening stock',
      gen_random_uuid()
    )$$,
    (select organization_id from mto_checkout_context),
    (select store_id from mto_checkout_context),
    (select component_product_id from mto_checkout_context)
  ),
  'component stock can be initialized'
);

select lives_ok(
  format(
    $$select public.open_register_shift(
      %L,%L,%L,1000,'MTO checkout test shift'
    )$$,
    (select organization_id from mto_checkout_context),
    (select store_id from mto_checkout_context),
    (select register_id from mto_checkout_context)
  ),
  'owner can open the register shift'
);

select ok(
  to_regprocedure(
    'private.is_made_to_order_composite(uuid,uuid)'
  ) is not null,
  'made-to-order classifier exists'
);

select ok(
  to_regprocedure(
    'private.consume_made_to_order_composite_sale(uuid,uuid,uuid,numeric,uuid,uuid,text)'
  ) is not null,
  'made-to-order sale consumption helper exists'
);

select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id =
      (select organization_id from mto_checkout_context)
      and store_id =
        (select store_id from mto_checkout_context)
      and product_id =
        (select composite_product_id from mto_checkout_context)
      and variant_id is null
  ),
  0::numeric,
  'made-to-order parent starts at zero finished stock'
);

select is(
  jsonb_array_length(
    public.validate_pos_cart_stock(
      (select organization_id from mto_checkout_context),
      (select store_id from mto_checkout_context),
      (select register_id from mto_checkout_context),
      jsonb_build_array(jsonb_build_object(
        'product_id',
          (select composite_product_id from mto_checkout_context),
        'variant_id', null,
        'quantity', 1
      ))
    ) -> 'items'
  ),
  0,
  'sufficient component stock allows MTO preflight despite zero parent stock'
);

reset role;

update public.inventory_levels
set quantity = 2
where organization_id =
    (select organization_id from mto_checkout_context)
  and store_id =
    (select store_id from mto_checkout_context)
  and product_id =
    (select component_product_id from mto_checkout_context)
  and variant_id is null;

set local role authenticated;
set local request.jwt.claim.sub =
  '90909090-9090-4090-8090-909090909090';

select is(
  jsonb_array_length(
    public.validate_pos_cart_stock(
      (select organization_id from mto_checkout_context),
      (select store_id from mto_checkout_context),
      (select register_id from mto_checkout_context),
      jsonb_build_array(jsonb_build_object(
        'product_id',
          (select composite_product_id from mto_checkout_context),
        'variant_id', null,
        'quantity', 1
      ))
    ) -> 'items'
  ),
  1,
  'component shortage creates one MTO stock warning'
);

select is(
  (
    public.validate_pos_cart_stock(
      (select organization_id from mto_checkout_context),
      (select store_id from mto_checkout_context),
      (select register_id from mto_checkout_context),
      jsonb_build_array(jsonb_build_object(
        'product_id',
          (select composite_product_id from mto_checkout_context),
        'variant_id', null,
        'quantity', 1
      ))
    ) -> 'items' -> 0 ->> 'product_id'
  )::uuid,
  (select component_product_id from mto_checkout_context),
  'preflight identifies the constrained component, not the parent'
);

select is(
  (
    public.validate_pos_cart_stock(
      (select organization_id from mto_checkout_context),
      (select store_id from mto_checkout_context),
      (select register_id from mto_checkout_context),
      jsonb_build_array(jsonb_build_object(
        'product_id',
          (select composite_product_id from mto_checkout_context),
        'variant_id', null,
        'quantity', 1
      ))
    ) -> 'items' -> 0 ->> 'projected_quantity'
  )::numeric,
  (-1)::numeric,
  'preflight projects recipe-component balance'
);

reset role;

update public.inventory_levels
set quantity = 5
where organization_id =
    (select organization_id from mto_checkout_context)
  and store_id =
    (select store_id from mto_checkout_context)
  and product_id =
    (select component_product_id from mto_checkout_context)
  and variant_id is null;

set local role authenticated;
set local request.jwt.claim.sub =
  '90909090-9090-4090-8090-909090909090';

insert into mto_checkout_results (label, sale_id, was_replayed)
select 'first', sale_id, was_replayed
from public.checkout_advanced_sale(
  (select organization_id from mto_checkout_context),
  (select store_id from mto_checkout_context),
  (select register_id from mto_checkout_context),
  '91919191-9191-4191-8191-919191919191',
  jsonb_build_array(jsonb_build_object(
    'product_id',
      (select composite_product_id from mto_checkout_context),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id',
      (
        select id
        from public.payment_methods
        where organization_id =
          (select organization_id from mto_checkout_context)
          and code = 'CASH'
        limit 1
      ),
    'amount_tendered_minor', 1000
  )),
  null, 0, null, null, null, null
);

select ok(
  (
    select sale_id is not null and not was_replayed
    from mto_checkout_results
    where label = 'first'
  ),
  'first MTO advanced checkout completes'
);

select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id =
      (select organization_id from mto_checkout_context)
      and store_id =
        (select store_id from mto_checkout_context)
      and product_id =
        (select component_product_id from mto_checkout_context)
      and variant_id is null
  ),
  2::numeric,
  'MTO sale consumes exactly three component units'
);

select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id =
      (select organization_id from mto_checkout_context)
      and store_id =
        (select store_id from mto_checkout_context)
      and product_id =
        (select composite_product_id from mto_checkout_context)
      and variant_id is null
  ),
  0::numeric,
  'MTO sale does not decrement parent finished stock'
);

select is(
  (
    select count(*)
    from public.inventory_movements
    where organization_id =
      (select organization_id from mto_checkout_context)
      and source_id =
        (select sale_id from mto_checkout_results where label = 'first')
      and source_type = 'composite_sale'
      and product_id =
        (select component_product_id from mto_checkout_context)
      and quantity_delta = -3
  ),
  1::bigint,
  'MTO sale creates one component movement'
);

select is(
  (
    select count(*)
    from public.inventory_movements
    where organization_id =
      (select organization_id from mto_checkout_context)
      and source_id =
        (select sale_id from mto_checkout_results where label = 'first')
      and product_id =
        (select composite_product_id from mto_checkout_context)
  ),
  0::bigint,
  'MTO sale creates no parent finished-stock movement'
);

insert into mto_checkout_results (label, sale_id, was_replayed)
select 'replay', sale_id, was_replayed
from public.checkout_advanced_sale(
  (select organization_id from mto_checkout_context),
  (select store_id from mto_checkout_context),
  (select register_id from mto_checkout_context),
  '91919191-9191-4191-8191-919191919191',
  jsonb_build_array(jsonb_build_object(
    'product_id',
      (select composite_product_id from mto_checkout_context),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id',
      (
        select id
        from public.payment_methods
        where organization_id =
          (select organization_id from mto_checkout_context)
          and code = 'CASH'
        limit 1
      ),
    'amount_tendered_minor', 1000
  )),
  null, 0, null, null, null, null
);

select ok(
  (
    select replay.was_replayed
      and replay.sale_id = first_sale.sale_id
    from mto_checkout_results replay
    cross join mto_checkout_results first_sale
    where replay.label = 'replay'
      and first_sale.label = 'first'
  ),
  'exact MTO checkout replay returns the original sale'
);

select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id =
      (select organization_id from mto_checkout_context)
      and store_id =
        (select store_id from mto_checkout_context)
      and product_id =
        (select component_product_id from mto_checkout_context)
      and variant_id is null
  ),
  2::numeric,
  'exact replay does not consume components twice'
);

select is(
  (
    select count(*)
    from public.inventory_movements
    where organization_id =
      (select organization_id from mto_checkout_context)
      and source_id =
        (select sale_id from mto_checkout_results where label = 'first')
      and source_type = 'composite_sale'
  ),
  1::bigint,
  'exact replay does not duplicate component movements'
);

select public.update_inventory_policy(
  organization_id,
  store_id,
  'warn'
)
from mto_checkout_context;

select is(
  jsonb_array_length(
    public.validate_pos_cart_stock(
      (select organization_id from mto_checkout_context),
      (select store_id from mto_checkout_context),
      (select register_id from mto_checkout_context),
      jsonb_build_array(jsonb_build_object(
        'product_id',
          (select composite_product_id from mto_checkout_context),
        'variant_id', null,
        'quantity', 1
      ))
    ) -> 'items'
  ),
  1,
  'warn policy reports the component shortage'
);

insert into mto_checkout_results (label, sale_id, was_replayed)
select 'warn-sale', sale_id, was_replayed
from public.checkout_advanced_sale(
  (select organization_id from mto_checkout_context),
  (select store_id from mto_checkout_context),
  (select register_id from mto_checkout_context),
  '92929292-9292-4292-8292-929292929292',
  jsonb_build_array(jsonb_build_object(
    'product_id',
      (select composite_product_id from mto_checkout_context),
    'variant_id', null,
    'quantity', 1
  )),
  jsonb_build_array(jsonb_build_object(
    'payment_method_id',
      (
        select id
        from public.payment_methods
        where organization_id =
          (select organization_id from mto_checkout_context)
          and code = 'CASH'
        limit 1
      ),
    'amount_tendered_minor', 1000
  )),
  null, 0, null, null, null, null
);

select ok(
  (
    select sale_id is not null and not was_replayed
    from mto_checkout_results
    where label = 'warn-sale'
  ),
  'warn policy permits MTO checkout'
);

select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id =
      (select organization_id from mto_checkout_context)
      and store_id =
        (select store_id from mto_checkout_context)
      and product_id =
        (select component_product_id from mto_checkout_context)
      and variant_id is null
  ),
  (-1)::numeric,
  'warn-policy sale applies the component movement once'
);

select is(
  public.get_checkout_stock_warning(
    (select organization_id from mto_checkout_context),
    (select store_id from mto_checkout_context),
    (select sale_id from mto_checkout_results where label = 'warn-sale')
  ),
  1,
  'post-sale warning counts the negative MTO component'
);

select is(
  (
    select quantity
    from public.inventory_levels
    where organization_id =
      (select organization_id from mto_checkout_context)
      and store_id =
        (select store_id from mto_checkout_context)
      and product_id =
        (select composite_product_id from mto_checkout_context)
      and variant_id is null
  ),
  0::numeric,
  'MTO parent remains unchanged under warn policy'
);

select is(
  (
    select count(*)
    from public.inventory_movements
    where organization_id =
      (select organization_id from mto_checkout_context)
      and product_id =
        (select composite_product_id from mto_checkout_context)
      and movement_type = 'SALE'
  ),
  0::bigint,
  'no MTO parent SALE movement is ever created'
);

select * from finish();

rollback;
