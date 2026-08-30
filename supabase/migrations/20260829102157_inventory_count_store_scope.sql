-- Inventory counts contain expected and counted quantities, so their read scope
-- must match the store-scoped inventory ledger and projections.
begin;

drop policy if exists inventory_counts_select_inventory_manager on public.inventory_counts;
create policy inventory_counts_select_authorized_scope
on public.inventory_counts for select to authenticated
using (
  (select private.has_permission(organization_id, 'inventory.manage'))
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists inventory_count_lines_select_inventory_manager on public.inventory_count_lines;
create policy inventory_count_lines_select_authorized_scope
on public.inventory_count_lines for select to authenticated
using (
  (select private.has_permission(organization_id, 'inventory.manage'))
  and exists (
    select 1
    from public.inventory_counts inventory_count
    where inventory_count.id = inventory_count_lines.inventory_count_id
      and inventory_count.organization_id = inventory_count_lines.organization_id
      and (select private.has_store_read_scope(inventory_count.organization_id, inventory_count.store_id))
  )
);

commit;
