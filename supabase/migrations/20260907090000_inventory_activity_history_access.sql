-- Phase 6: inventory activity/history access alignment.
--
-- The Back Office authorizes inventory viewers, counters, adjusters, and
-- managers to enter the existing Inventory Activity workspace.  Keep RLS in
-- agreement with that capability model, while preserving store scope and
-- keeping valuation fields behind the dedicated cost RPC.

begin;

drop policy if exists inventory_levels_select_authorized_scope on public.inventory_levels;
create policy inventory_levels_select_authorized_scope on public.inventory_levels
  for select to authenticated
  using (
    (
      (select private.has_permission(organization_id, 'inventory.view'))
      or (select private.has_permission(organization_id, 'inventory.adjust'))
      or (select private.has_permission(organization_id, 'inventory.count'))
      or (select private.has_permission(organization_id, 'inventory.manage'))
    )
    and (select private.has_store_read_scope(organization_id, store_id))
  );

drop policy if exists inventory_movements_select_authorized on public.inventory_movements;
create policy inventory_movements_select_authorized on public.inventory_movements
  for select to authenticated
  using (
    (
      (select private.has_permission(organization_id, 'inventory.view'))
      or (select private.has_permission(organization_id, 'inventory.adjust'))
      or (select private.has_permission(organization_id, 'inventory.count'))
      or (select private.has_permission(organization_id, 'inventory.manage'))
    )
    and (select private.has_store_read_scope(organization_id, store_id))
  );

-- `unit_snapshot` is an immutable, non-financial ledger field.  Reading it
-- lets historical activity retain the unit that was true at posting time even
-- if the product is later archived or its presentation unit changes.  Cost and
-- value columns remain ungranted and continue to be served only by the
-- permission-checked cost RPC.
grant select (unit_snapshot) on table public.inventory_movements to authenticated;

comment on column public.inventory_movements.unit_snapshot is
  'Immutable base-unit snapshot, readable with authorized inventory activity; costs remain restricted to dedicated RPCs.';

commit;
