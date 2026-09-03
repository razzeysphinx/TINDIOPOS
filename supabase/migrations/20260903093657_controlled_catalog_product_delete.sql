begin;

create or replace function private.delete_catalog_product_if_eligible(
  target_organization_id uuid,
  target_product_id uuid,
  target_confirmation_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_name text;
  existing_status text;
  actor_employee_id uuid;
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

  if existing_status <> 'archived' then
    raise exception 'Archive this product before deleting it permanently.' using errcode = '55000';
  end if;

  if btrim(coalesce(target_confirmation_name, '')) <> existing_name then
    raise exception 'Enter the exact product name to confirm permanent deletion.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.audit_logs audit
    where audit.organization_id = target_organization_id
      and audit.metadata ->> 'product_id' = target_product_id::text
  ) then
    raise exception 'This product has audit history and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.product_components component
    where component.organization_id = target_organization_id
      and component.component_product_id = target_product_id
  ) then
    raise exception 'This product is used by a composite product and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.product_id = target_product_id
      and level.quantity <> 0
  ) then
    raise exception 'This product has stock on hand and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end if;

  begin
    -- Empty inventory rows and unsold variants are setup records, not business
    -- history. Removing them allows a never-used archived product to be deleted
    -- while every financial, inventory, purchasing, count, transfer, and receipt
    -- relationship continues to be protected by its restrictive foreign key.
    delete from public.inventory_levels
    where organization_id = target_organization_id
      and product_id = target_product_id;

    delete from public.product_variants
    where organization_id = target_organization_id
      and product_id = target_product_id;

    delete from public.products
    where organization_id = target_organization_id
      and id = target_product_id;
  exception
    when foreign_key_violation then
      raise exception 'This product has business history and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end;

  perform private.write_audit_log(
    target_organization_id,
    'CATALOG_PRODUCT_DELETED',
    'DELETE_CATALOG_PRODUCT',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    'Archived product permanently deleted after dependency checks.',
    jsonb_build_object('product_id', target_product_id, 'product_name', existing_name)
  );

  return existing_name;
end;
$$;

create or replace function public.delete_catalog_product_if_eligible(
  target_organization_id uuid,
  target_product_id uuid,
  target_confirmation_name text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.delete_catalog_product_if_eligible(
    target_organization_id,
    target_product_id,
    target_confirmation_name
  );
$$;

revoke execute on function private.delete_catalog_product_if_eligible(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke execute on function public.delete_catalog_product_if_eligible(uuid, uuid, text)
from public, anon, authenticated, service_role;

grant execute on function private.delete_catalog_product_if_eligible(uuid, uuid, text)
to authenticated;
grant execute on function public.delete_catalog_product_if_eligible(uuid, uuid, text)
to authenticated;

comment on function public.delete_catalog_product_if_eligible(uuid, uuid, text)
is 'Permanently deletes only archived, exactly confirmed products without stock, audit records, component use, or restrictive business-history dependencies. Requires products.manage.';

commit;
