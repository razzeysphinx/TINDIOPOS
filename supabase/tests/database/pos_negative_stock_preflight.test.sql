begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  to_regprocedure('public.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)') is not null,
  'POS cart stock preflight exists'
);
select ok(
  not has_function_privilege('anon', 'public.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)', 'execute'),
  'anonymous callers cannot inspect POS stock'
);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '814d8863-8d97-43dd-885e-563168c7c952',
  'stock-preflight-owner@tindio.test',
  '{"full_name":"Stock Preflight Owner"}'::jsonb
);

create temporary table stock_preflight_context (
  organization_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  tracked_product_id uuid,
  untracked_product_id uuid
);
grant select, insert, update on stock_preflight_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '814d8863-8d97-43dd-885e-563168c7c952';

insert into stock_preflight_context (organization_id, store_id, register_id)
select organization_id, store_id, register_id
from public.bootstrap_organization(
  'Stock Preflight Retail',
  'Stock Preflight Main',
  'Stock Preflight Counter'
);

update stock_preflight_context
set tracked_product_id = public.create_catalog_product(
  organization_id, null, 'Tracked preflight item', '', 'simple',
  'STOCK-PREFLIGHT-TRACKED', '480000077700', 1000, 500, true, 'each',
  array[store_id], '[]'::jsonb
);

update stock_preflight_context
set untracked_product_id = public.create_catalog_product(
  organization_id, null, 'Untracked preflight item', '', 'simple',
  'STOCK-PREFLIGHT-UNTRACKED', '480000077701', 1000, 0, false, 'each',
  array[store_id], '[]'::jsonb
);

select public.open_register_shift(
  organization_id, store_id, register_id, 0, 'Stock preflight test shift'
)
from stock_preflight_context;

select is(
  public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) ->> 'policy',
  'block',
  'missing store policy safely defaults to block'
)
from stock_preflight_context;

select is(
  jsonb_array_length(public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) -> 'items'),
  1,
  'zero available and one in cart produces one affected item'
)
from stock_preflight_context;

select is(
  (public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) -> 'items' -> 0 ->> 'available_quantity')::numeric,
  0::numeric,
  'preflight reports canonical available quantity'
)
from stock_preflight_context;

select is(
  (public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) -> 'items' -> 0 ->> 'projected_quantity')::numeric,
  (-1)::numeric,
  'preflight warns only when the sale projects below zero'
)
from stock_preflight_context;

reset role;
update public.inventory_levels
set quantity = 1
where product_id = (select tracked_product_id from stock_preflight_context)
  and store_id = (select store_id from stock_preflight_context);
set local role authenticated;
set local request.jwt.claim.sub = '814d8863-8d97-43dd-885e-563168c7c952';

select is(
  jsonb_array_length(public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) -> 'items'),
  0,
  'projected quantity exactly zero does not warn'
)
from stock_preflight_context;

select public.update_inventory_policy(organization_id, store_id, 'warn')
from stock_preflight_context;
select is(
  public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 2
    ))
  ) ->> 'policy',
  'warn',
  'warn policy remains informational in the preflight result'
)
from stock_preflight_context;

select public.update_inventory_policy(organization_id, store_id, 'allow')
from stock_preflight_context;
select is(
  public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 2
    ))
  ) ->> 'policy',
  'allow',
  'allow policy proceeds without an interruption'
)
from stock_preflight_context;

select is(
  jsonb_array_length(public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', untracked_product_id, 'variant_id', null, 'quantity', 10
    ))
  ) -> 'items'),
  0,
  'untracked products are excluded from the safeguard'
)
from stock_preflight_context;

select ok(
  to_regprocedure('public.get_checkout_stock_warning(uuid,uuid,uuid)') is not null,
  'post-payment warning can be scoped to the completed sale'
);

select * from finish();
rollback;
