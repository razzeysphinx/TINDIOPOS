begin;

alter table public.product_store_settings
  add column if not exists restock_policy text not null default 'restock';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_store_settings_restock_policy_values'
      and conrelid = 'public.product_store_settings'::regclass
  ) then
    alter table public.product_store_settings
      add constraint product_store_settings_restock_policy_values
      check (restock_policy in ('restock', 'do_not_restock'));
  end if;
end;
$$;

create or replace function private.set_catalog_product_store_configuration_v2(
  target_organization_id uuid,
  target_product_id uuid,
  target_store_id uuid,
  target_price_override_minor bigint,
  target_low_stock_level numeric,
  target_restock_policy text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  if not (select private.has_store_read_scope(target_organization_id, target_store_id)) then
    raise exception 'Store access is required to configure this product.' using errcode = '42501';
  end if;

  if target_restock_policy not in ('restock', 'do_not_restock') then
    raise exception 'Choose a valid restock intention.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.products product
    where product.id = target_product_id
      and product.organization_id = target_organization_id
  ) or not exists (
    select 1
    from public.stores store_record
    where store_record.id = target_store_id
      and store_record.organization_id = target_organization_id
      and store_record.is_active
  ) then
    raise exception 'Select an active store and product in this organization.' using errcode = '23503';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);

  insert into public.product_store_settings (
    organization_id,
    product_id,
    store_id,
    is_available,
    price_override_minor,
    low_stock_level,
    restock_policy
  ) values (
    target_organization_id,
    target_product_id,
    target_store_id,
    true,
    target_price_override_minor,
    target_low_stock_level,
    target_restock_policy
  )
  on conflict (store_id, product_id) do update
  set is_available = excluded.is_available,
      price_override_minor = excluded.price_override_minor,
      low_stock_level = excluded.low_stock_level,
      restock_policy = excluded.restock_policy;

  perform private.write_audit_log(
    target_organization_id,
    'PRODUCT_STORE_CONFIGURATION_UPDATED',
    'products.manage',
    actor_employee_id,
    null,
    target_store_id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'product_id', target_product_id,
      'price_override_minor', target_price_override_minor,
      'low_stock_level', target_low_stock_level,
      'restock_policy', target_restock_policy
    )
  );
end;
$$;

create or replace function public.set_catalog_product_store_configuration_v2(
  target_organization_id uuid,
  target_product_id uuid,
  target_store_id uuid,
  target_price_override_minor bigint,
  target_low_stock_level numeric,
  target_restock_policy text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.set_catalog_product_store_configuration_v2(
    target_organization_id,
    target_product_id,
    target_store_id,
    target_price_override_minor,
    target_low_stock_level,
    target_restock_policy
  );
$$;

create or replace function private.set_catalog_product_archived_safely(
  target_organization_id uuid,
  target_product_id uuid,
  target_is_archived boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  existing_name text;
  existing_status text;
  next_status text := case when target_is_archived then 'archived' else 'active' end;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);

  select product.name, product.status
  into existing_name, existing_status
  from public.products product
  where product.id = target_product_id
    and product.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  if existing_status = next_status then
    return existing_name;
  end if;

  if target_is_archived and exists (
    select 1
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.product_id = target_product_id
      and level.quantity <> 0
  ) then
    raise exception 'Resolve this product’s stock on hand before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.purchase_order_lines line
    join public.purchase_orders purchase_order
      on purchase_order.id = line.purchase_order_id
     and purchase_order.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and purchase_order.status in ('draft', 'ordered', 'partially_received')
  ) then
    raise exception 'Resolve open purchase orders for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.inventory_count_lines line
    join public.inventory_counts inventory_count
      on inventory_count.id = line.inventory_count_id
     and inventory_count.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and inventory_count.status in ('draft', 'in_progress', 'ready_for_review', 'open')
  ) then
    raise exception 'Finish or cancel open inventory counts for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.stock_request_lines line
    join public.stock_requests request
      on request.id = line.stock_request_id
     and request.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and request.status in ('requested', 'approved', 'picking', 'dispatched', 'partially_received')
  ) then
    raise exception 'Resolve open stock requests for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.stock_transfer_lines line
    join public.stock_transfers transfer
      on transfer.id = line.stock_transfer_id
     and transfer.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and transfer.status in ('in_transit', 'partially_received')
  ) then
    raise exception 'Receive or resolve open transfers for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.product_components component
    join public.products parent_product
      on parent_product.id = component.product_id
     and parent_product.organization_id = component.organization_id
    where component.organization_id = target_organization_id
      and component.component_product_id = target_product_id
      and parent_product.status = 'active'
  ) then
    raise exception 'Remove this product from active composite recipes before archiving it.' using errcode = '55000';
  end if;

  update public.products
  set status = next_status
  where organization_id = target_organization_id
    and id = target_product_id;

  perform private.write_audit_log(
    target_organization_id,
    case when target_is_archived then 'CATALOG_PRODUCT_ARCHIVED' else 'CATALOG_PRODUCT_RESTORED' end,
    'products.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('product_id', target_product_id, 'product_name', existing_name)
  );

  return existing_name;
end;
$$;

create or replace function public.set_catalog_product_archived_safely(
  target_organization_id uuid,
  target_product_id uuid,
  target_is_archived boolean
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.set_catalog_product_archived_safely(
    target_organization_id,
    target_product_id,
    target_is_archived
  );
$$;

revoke execute on function private.set_catalog_product_store_configuration_v2(uuid, uuid, uuid, bigint, numeric, text)
from public, anon, authenticated, service_role;
revoke execute on function public.set_catalog_product_store_configuration_v2(uuid, uuid, uuid, bigint, numeric, text)
from public, anon, authenticated, service_role;
grant execute on function public.set_catalog_product_store_configuration_v2(uuid, uuid, uuid, bigint, numeric, text)
to authenticated;

revoke execute on function private.set_catalog_product_archived_safely(uuid, uuid, boolean)
from public, anon, authenticated, service_role;
revoke execute on function public.set_catalog_product_archived_safely(uuid, uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.set_catalog_product_archived_safely(uuid, uuid, boolean)
to authenticated;

comment on column public.product_store_settings.restock_policy
is 'Explicit per-store replenishment intention. This never changes stock, POS availability, or product lifecycle automatically.';

comment on function public.set_catalog_product_store_configuration_v2(uuid, uuid, uuid, bigint, numeric, text)
is 'Persists authorized product store price, low-stock, and restock intention settings with an audit record.';

comment on function public.set_catalog_product_archived_safely(uuid, uuid, boolean)
is 'Archives products only after centrally authorized checks for stock, active purchasing, counts, requests, transfers, and active composite dependencies.';

commit;
