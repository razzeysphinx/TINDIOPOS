begin;

create or replace function public.get_inventory_health_awareness(
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
  count_number bigint,
  days_since_count integer,
  count_recommended boolean
)
language sql
security invoker
set search_path = ''
as $$
  select
    awareness.store_id,
    awareness.product_id,
    awareness.variant_id,
    awareness.last_counted_at,
    awareness.expected_quantity,
    awareness.counted_quantity,
    awareness.inventory_count_id,
    awareness.count_number,
    case
      when awareness.last_counted_at is null then null
      else greatest(0, floor(extract(epoch from (now() - awareness.last_counted_at)) / 86400))::integer
    end as days_since_count,
    awareness.last_counted_at is null
      or awareness.last_counted_at < now() - interval '30 days' as count_recommended
  from private.get_inventory_count_awareness(target_organization_id) awareness;
$$;

revoke execute on function public.get_inventory_health_awareness(uuid) from public, anon, service_role;
grant execute on function public.get_inventory_health_awareness(uuid) to authenticated;

comment on function public.get_inventory_health_awareness(uuid)
is 'Adds database-clock age awareness to the existing permission-checked latest physical-count facts. The 30-day recommendation is informational and does not enforce a policy.';

commit;
