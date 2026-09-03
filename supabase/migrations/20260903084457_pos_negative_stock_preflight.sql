-- Apply the existing store-level negative-stock policy before the cashier
-- enters payment. The final checkout remains authoritative and the existing
-- inventory trigger continues to enforce the block policy under concurrency.
begin;

create or replace function private.validate_pos_cart_stock(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  selected_line record;
  resolved_policy text;
  affected_items jsonb;
begin
  perform private.require_pos_capabilities(
    target_organization_id,
    array['pos.access', 'sales.create', 'payments.accept']
  );

  if target_store_id is null or target_register_id is null
    or target_items is null or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'A store, register, and one or more cart items are required.' using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.registers register
    on register.id = target_register_id
   and register.organization_id = employee.organization_id
   and register.store_id = target_store_id
   and register.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.store_id = target_store_id
      and shift.register_id = target_register_id
      and shift.opened_by_employee_id = actor_employee_id
      and shift.status = 'open'
  ) then
    raise exception 'Open your assigned register shift before charging a sale.' using errcode = '42501';
  end if;

  for selected_line in select value from jsonb_array_elements(target_items)
  loop
    if jsonb_typeof(selected_line.value) <> 'object'
      or jsonb_typeof(selected_line.value -> 'product_id') <> 'string'
      or coalesce(selected_line.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        selected_line.value -> 'variant_id' is distinct from 'null'::jsonb
        and jsonb_typeof(selected_line.value -> 'variant_id') <> 'string'
      )
      or (
        nullif(selected_line.value ->> 'variant_id', '') is not null
        and selected_line.value ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or jsonb_typeof(selected_line.value -> 'quantity') <> 'number'
      or coalesce(selected_line.value ->> 'quantity', '') !~ '^(?:0|[1-9][0-9]{0,3})(?:[.][0-9]{1,3})?$'
      or (selected_line.value ->> 'quantity')::numeric(14,3) <= 0 then
      raise exception 'Each stock-check item must have valid references and a positive quantity.' using errcode = '23514';
    end if;
  end loop;

  select coalesce(policy.negative_stock_policy, 'block')
  into resolved_policy
  from (select 1) seed
  left join public.inventory_policies policy
    on policy.organization_id = target_organization_id
   and policy.store_id = target_store_id;

  with requested_items as (
    select
      (line.value ->> 'product_id')::uuid product_id,
      nullif(line.value ->> 'variant_id', '')::uuid variant_id,
      sum((line.value ->> 'quantity')::numeric(14,3)) cart_quantity
    from jsonb_array_elements(target_items) line(value)
    group by
      (line.value ->> 'product_id')::uuid,
      nullif(line.value ->> 'variant_id', '')::uuid
  ), tracked_items as (
    select
      requested.product_id,
      requested.variant_id,
      requested.cart_quantity,
      product.name product_name,
      variant.name variant_name,
      coalesce(level.quantity, 0::numeric) available_quantity
    from requested_items requested
    join public.products product
      on product.id = requested.product_id
     and product.organization_id = target_organization_id
     and product.status = 'active'
     and product.track_inventory
    join public.product_store_settings setting
      on setting.organization_id = product.organization_id
     and setting.product_id = product.id
     and setting.store_id = target_store_id
     and setting.is_available
    left join public.product_variants variant
      on variant.id = requested.variant_id
     and variant.product_id = product.id
     and variant.organization_id = product.organization_id
     and variant.is_active
    left join public.inventory_levels level
      on level.organization_id = product.organization_id
     and level.store_id = target_store_id
     and level.product_id = product.id
     and level.variant_id is not distinct from requested.variant_id
    where (requested.variant_id is null and product.product_type = 'simple')
       or (requested.variant_id is not null and product.product_type = 'variable' and variant.id is not null)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', tracked.product_id,
        'variant_id', tracked.variant_id,
        'product_name', tracked.product_name,
        'variant_name', tracked.variant_name,
        'available_quantity', tracked.available_quantity,
        'cart_quantity', tracked.cart_quantity,
        'projected_quantity', tracked.available_quantity - tracked.cart_quantity
      )
      order by lower(tracked.product_name), lower(coalesce(tracked.variant_name, ''))
    ) filter (where tracked.available_quantity - tracked.cart_quantity < 0),
    '[]'::jsonb
  )
  into affected_items
  from tracked_items tracked;

  return jsonb_build_object(
    'policy', resolved_policy,
    'items', affected_items,
    'checked_at', clock_timestamp()
  );
end;
$$;

create or replace function public.validate_pos_cart_stock(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_items jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.validate_pos_cart_stock(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_items
  );
$$;

revoke execute on function private.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)
from public, anon, authenticated, service_role;
revoke execute on function public.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)
from public, anon, service_role;
grant execute on function public.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)
to authenticated;

comment on function public.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)
is 'Returns the current store negative-stock policy and consolidated tracked cart lines that would fall below zero before payment.';

-- Keep the completion message scoped to this sale instead of reporting every
-- historical negative position in the store.
create or replace function private.get_checkout_stock_warning(
  target_organization_id uuid,
  target_store_id uuid,
  target_sale_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare negative_item_count integer;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;
  if private.inventory_actor(target_organization_id, target_store_id) is null then
    raise exception 'You are not assigned to this store.' using errcode = '42501';
  end if;
  if coalesce((
    select policy.negative_stock_policy
    from public.inventory_policies policy
    where policy.organization_id = target_organization_id
      and policy.store_id = target_store_id
  ), 'block') <> 'warn' then
    return 0;
  end if;
  if not exists (
    select 1 from public.sales sale
    where sale.id = target_sale_id
      and sale.organization_id = target_organization_id
      and sale.store_id = target_store_id
  ) then
    raise exception 'The completed sale was not found in this store.' using errcode = 'P0002';
  end if;

  select count(*)::integer
  into negative_item_count
  from (
    select item.product_id, item.variant_id
    from public.sale_items item
    join public.products product
      on product.id = item.product_id
     and product.organization_id = item.organization_id
     and product.track_inventory
    join public.inventory_levels level
      on level.organization_id = item.organization_id
     and level.store_id = target_store_id
     and level.product_id = item.product_id
     and level.variant_id is not distinct from item.variant_id
     and level.quantity < 0
    where item.organization_id = target_organization_id
      and item.sale_id = target_sale_id
    group by item.product_id, item.variant_id
  ) affected;
  return negative_item_count;
end;
$$;

create or replace function public.get_checkout_stock_warning(
  target_organization_id uuid,
  target_store_id uuid,
  target_sale_id uuid
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.get_checkout_stock_warning(
    target_organization_id,
    target_store_id,
    target_sale_id
  );
$$;

revoke execute on function private.get_checkout_stock_warning(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.get_checkout_stock_warning(uuid,uuid,uuid)
from public, anon, service_role;
grant execute on function public.get_checkout_stock_warning(uuid,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
