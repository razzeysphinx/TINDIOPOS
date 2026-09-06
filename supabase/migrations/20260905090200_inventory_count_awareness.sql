begin;

create or replace function private.get_inventory_count_awareness(
  target_organization_id uuid
)
returns table (
  store_id uuid,
  product_id uuid,
  variant_id uuid,
  last_counted_at timestamptz,
  expected_quantity numeric,
  counted_quantity numeric,
  inventory_count_id uuid,
  count_number bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (
    (select private.has_permission(target_organization_id, 'inventory.view'))
    or (select private.has_permission(target_organization_id, 'inventory.count'))
    or (select private.has_permission(target_organization_id, 'inventory.manage'))
  ) then
    raise exception 'Inventory read permission is required.' using errcode = '42501';
  end if;

  return query
  select
    level.store_id,
    level.product_id,
    level.variant_id,
    latest.last_counted_at,
    latest.expected_quantity,
    latest.counted_quantity,
    latest.inventory_count_id,
    latest.count_number
  from public.inventory_levels level
  join public.products product
    on product.id = level.product_id
   and product.organization_id = level.organization_id
   and product.status = 'active'
   and product.track_inventory
  left join lateral (
    select
      coalesce(count_document.completed_at, count_document.updated_at) as last_counted_at,
      count_line.expected_quantity,
      count_line.counted_quantity,
      count_document.id as inventory_count_id,
      count_document.count_number
    from public.inventory_count_lines count_line
    join public.inventory_counts count_document
      on count_document.id = count_line.inventory_count_id
     and count_document.organization_id = count_line.organization_id
    where count_line.organization_id = target_organization_id
      and count_document.store_id = level.store_id
      and count_line.product_id = level.product_id
      and count_line.variant_id is not distinct from level.variant_id
      and count_line.counted_quantity is not null
      and count_document.status in ('posted', 'completed')
    order by coalesce(count_document.completed_at, count_document.updated_at) desc,
      count_document.id desc
    limit 1
  ) latest on true
  where level.organization_id = target_organization_id
    and (select private.has_store_read_scope(target_organization_id, level.store_id))
  order by level.store_id, level.product_id, level.variant_id nulls first;
end;
$$;

create or replace function public.get_inventory_count_awareness(
  target_organization_id uuid
)
returns table (
  store_id uuid,
  product_id uuid,
  variant_id uuid,
  last_counted_at timestamptz,
  expected_quantity numeric,
  counted_quantity numeric,
  inventory_count_id uuid,
  count_number bigint
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_inventory_count_awareness(target_organization_id);
$$;

revoke execute on function private.get_inventory_count_awareness(uuid) from public, anon, service_role;
grant execute on function private.get_inventory_count_awareness(uuid) to authenticated;
revoke execute on function public.get_inventory_count_awareness(uuid) from public, anon, service_role;
grant execute on function public.get_inventory_count_awareness(uuid) to authenticated;

comment on function public.get_inventory_count_awareness(uuid)
is 'Returns the latest completed physical-count fact for each authorized active tracked stock position. It is read-only awareness and does not enforce count frequency.';

commit;
