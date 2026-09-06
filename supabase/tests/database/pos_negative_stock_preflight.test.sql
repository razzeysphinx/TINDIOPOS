begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table(
  'public',
  'inventory_policy_defaults',
  'organization-level negative-stock policy defaults exist'
);
select ok(
  to_regprocedure('public.update_organization_inventory_policy(uuid,text)') is not null,
  'organization-level policy routine exists'
);
select ok(
  to_regprocedure('public.remove_inventory_policy_override(uuid,uuid)') is not null,
  'store-override removal routine exists'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_policy_defaults', 'insert'),
  'authenticated callers cannot write organization defaults directly'
);

select ok(
  to_regprocedure('public.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)') is not null,
  'POS cart stock preflight exists'
);
select ok(
  not has_function_privilege('anon', 'public.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)', 'execute'),
  'anonymous callers cannot inspect POS stock'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '814d8863-8d97-43dd-885e-563168c7c952',
    'stock-preflight-owner@tindio.test',
    '{"full_name":"Stock Preflight Owner"}'::jsonb
  ),
  (
    '815d8863-8d97-43dd-885e-563168c7c952',
    'stock-preflight-scoped-manager@tindio.test',
    '{"full_name":"Stock Preflight Scoped Manager"}'::jsonb
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

select public.update_organization_inventory_policy(organization_id, 'warn')
from stock_preflight_context;
select is(
  (
    select negative_stock_policy
    from public.inventory_policy_defaults
    where organization_id = (select organization_id from stock_preflight_context)
  ),
  'warn',
  'the organization default is persisted once for the organization'
);
select is(
  public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) ->> 'policy',
  'warn',
  'a store without an override inherits the organization default'
)
from stock_preflight_context;
select public.update_inventory_policy(organization_id, store_id, 'block')
from stock_preflight_context;
select is(
  public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) ->> 'policy',
  'block',
  'a store override wins over the organization default'
)
from stock_preflight_context;
select public.remove_inventory_policy_override(organization_id, store_id)
from stock_preflight_context;
select is(
  public.validate_pos_cart_stock(
    organization_id, store_id, register_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', tracked_product_id, 'variant_id', null, 'quantity', 1
    ))
  ) ->> 'policy',
  'warn',
  'removing the override immediately returns the store to its inherited policy'
)
from stock_preflight_context;
select is(
  (
    select count(*)
    from public.audit_logs audit
    where audit.organization_id = (select organization_id from stock_preflight_context)
      and audit.event_type in ('INVENTORY_POLICY_DEFAULT_UPDATED', 'INVENTORY_POLICY_OVERRIDE_REMOVED')
  ),
  2::bigint,
  'default changes and override removal retain an authoritative audit trail'
);

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

reset role;
insert into public.employees (organization_id, profile_id, employee_number, job_title)
select organization_id, '815d8863-8d97-43dd-885e-563168c7c952', 'STOCK-SCOPED-001', 'Scoped inventory manager'
from stock_preflight_context;
insert into public.roles (organization_id, name, code, is_system)
select organization_id, 'Scoped inventory manager', 'scoped_inventory_manager', false
from stock_preflight_context;
insert into public.role_permissions (organization_id, role_id, permission_code)
select context.organization_id, role.id, 'inventory.manage'
from stock_preflight_context context
join public.roles role
  on role.organization_id = context.organization_id
 and role.code = 'scoped_inventory_manager';
insert into public.employee_roles (organization_id, employee_id, role_id)
select employee.organization_id, employee.id, role.id
from public.employees employee
join stock_preflight_context context on context.organization_id = employee.organization_id
join public.roles role
  on role.organization_id = employee.organization_id
 and role.code = 'scoped_inventory_manager'
where employee.profile_id = '815d8863-8d97-43dd-885e-563168c7c952';
insert into public.employee_stores (organization_id, employee_id, store_id)
select employee.organization_id, employee.id, context.store_id
from public.employees employee
join stock_preflight_context context on context.organization_id = employee.organization_id
where employee.profile_id = '815d8863-8d97-43dd-885e-563168c7c952';

set local role authenticated;
set local request.jwt.claim.sub = '815d8863-8d97-43dd-885e-563168c7c952';
select throws_ok(
  format(
    $$select public.update_organization_inventory_policy(%L, 'block')$$,
    (select organization_id from stock_preflight_context)
  ),
  '42501',
  'Organization-wide inventory policy permission is required.',
  'a store-scoped inventory manager cannot change the organization default'
);
select lives_ok(
  format(
    $$select public.update_inventory_policy(%L, %L, 'block')$$,
    (select organization_id from stock_preflight_context),
    (select store_id from stock_preflight_context)
  ),
  'a scoped inventory manager can still save an override for an assigned store'
);

select * from finish();
rollback;
