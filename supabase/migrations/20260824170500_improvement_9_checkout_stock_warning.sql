-- Cashiers need a safe, limited post-checkout warning without receiving broad
-- access to inventory policy or ledger tables.
begin;

create or replace function private.get_checkout_stock_warning(
  target_organization_id uuid,
  target_store_id uuid
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
  if coalesce((select policy.negative_stock_policy from public.inventory_policies policy where policy.organization_id = target_organization_id and policy.store_id = target_store_id), 'block') <> 'warn' then
    return 0;
  end if;
  select count(*)::integer into negative_item_count
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and level.quantity < 0;
  return negative_item_count;
end;
$$;

create or replace function public.get_checkout_stock_warning(
  target_organization_id uuid,
  target_store_id uuid
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.get_checkout_stock_warning(target_organization_id, target_store_id);
$$;

revoke execute on function private.get_checkout_stock_warning(uuid,uuid), public.get_checkout_stock_warning(uuid,uuid) from public, anon, service_role;
grant usage on schema private to authenticated;
grant execute on function private.get_checkout_stock_warning(uuid,uuid), public.get_checkout_stock_warning(uuid,uuid) to authenticated;

commit;
