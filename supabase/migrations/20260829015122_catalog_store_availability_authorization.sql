-- Store availability is a catalog capability, but its scope must match the
-- caller's actual branch scope. Keep the raw table policies restrictive and
-- make the multi-store edit one atomic, server-authorized operation.
begin;

create or replace function private.set_catalog_product_store_availability(
  target_organization_id uuid,
  target_product_id uuid,
  target_store_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  manageable_store_ids uuid[];
  selected_store_ids uuid[];
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.products product
    where product.id = target_product_id
      and product.organization_id = target_organization_id
  ) then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  -- Organization-wide store managers (including Owner) can manage every
  -- active store. Other product managers are limited to their employee-store
  -- assignments through the same scope predicate used by Back Office reads.
  select coalesce(array_agg(store.id order by store.id), '{}'::uuid[])
  into manageable_store_ids
  from public.stores store
  where store.organization_id = target_organization_id
    and store.is_active
    and (select private.has_store_read_scope(target_organization_id, store.id));

  if cardinality(manageable_store_ids) = 0 then
    raise exception 'No active stores are available for this product.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct requested.store_id), '{}'::uuid[])
  into selected_store_ids
  from unnest(coalesce(target_store_ids, '{}'::uuid[])) as requested(store_id);

  if exists (
    select 1
    from unnest(selected_store_ids) as selected(store_id)
    where not (selected.store_id = any(manageable_store_ids))
  ) then
    raise exception 'Store access is required to change product availability.' using errcode = '42501';
  end if;

  -- Never delete product_store_settings. A store removed from the selected
  -- list becomes unavailable, retaining its configuration and inventory
  -- history for audit and future reactivation.
  insert into public.product_store_settings (
    organization_id,
    product_id,
    store_id,
    is_available
  )
  select
    target_organization_id,
    target_product_id,
    managed.store_id,
    managed.store_id = any(selected_store_ids)
  from unnest(manageable_store_ids) as managed(store_id)
  on conflict (store_id, product_id) do update
  set is_available = excluded.is_available
  where public.product_store_settings.is_available is distinct from excluded.is_available;

  return cardinality(selected_store_ids);
end;
$$;

create or replace function public.set_catalog_product_store_availability(
  target_organization_id uuid,
  target_product_id uuid,
  target_store_ids uuid[]
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.set_catalog_product_store_availability(
    target_organization_id,
    target_product_id,
    target_store_ids
  );
$$;

revoke execute on function private.set_catalog_product_store_availability(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
revoke execute on function public.set_catalog_product_store_availability(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;

grant execute on function private.set_catalog_product_store_availability(uuid, uuid, uuid[])
to authenticated;
grant execute on function public.set_catalog_product_store_availability(uuid, uuid, uuid[])
to authenticated;

-- Direct API/table attempts need the same store boundary as the reviewed RPC.
drop policy if exists product_store_settings_insert_authorized on public.product_store_settings;
create policy product_store_settings_insert_authorized
on public.product_store_settings for insert
to authenticated
with check (
  (select private.has_permission(organization_id, 'products.manage'))
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists product_store_settings_update_authorized on public.product_store_settings;
create policy product_store_settings_update_authorized
on public.product_store_settings for update
to authenticated
using (
  (select private.has_permission(organization_id, 'products.manage'))
  and (select private.has_store_read_scope(organization_id, store_id))
)
with check (
  (select private.has_permission(organization_id, 'products.manage'))
  and (select private.has_store_read_scope(organization_id, store_id))
);

comment on function public.set_catalog_product_store_availability(uuid, uuid, uuid[])
is 'Atomically sets product availability for active stores within the caller''s authorized branch scope. Requires products.manage.';

commit;
