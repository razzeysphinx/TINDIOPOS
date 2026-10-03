begin;

drop policy if exists
  inventory_levels_select_authorized_scope
on public.inventory_levels;

create policy inventory_levels_select_authorized_scope
on public.inventory_levels
for select
to authenticated
using (
  (
    -- Explicit read authority.
    (select private.has_permission(
      organization_id,
      'inventory.view'
    ))

    -- Existing manager authority.
    or (select private.has_permission(
      organization_id,
      'inventory.manage'
    ))

    -- Inventory workflows that require current operational stock.
    or (select private.has_any_inventory_capability(
      organization_id,
      array[
        'inventory.adjust.create',
        'inventory.adjust.post',
        'inventory.count.create',
        'inventory.count.finalize',
        'inventory.transfer.create',
        'inventory.transfer.send',
        'inventory.transfer.receive',
        'purchasing.po.create',
        'purchasing.receive',
        'purchasing.return'
      ]::text[]
    ))

    -- Valuation access requires BOTH cost authority and valuation authority.
    or (
      (select private.has_permission(
        organization_id,
        'products.view_cost'
      ))
      and
      (select private.has_inventory_capability(
        organization_id,
        'inventory.valuation.view'
      ))
    )
  )

  -- Never weaken store scope.
  and (
    select private.has_store_read_scope(
      organization_id,
      store_id
    )
  )
);

comment on policy
  inventory_levels_select_authorized_scope
on public.inventory_levels
is
'Store-scoped operational stock projection read access aligned with TINDIO granular inventory workflow capabilities.';

commit;
