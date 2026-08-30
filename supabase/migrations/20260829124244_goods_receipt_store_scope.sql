-- Receiving records contain supplier, purchase, quantity, and employee history.
-- Keep their read scope consistent with the store-scoped purchase-order policies.
begin;

drop policy if exists goods_receipts_select_inventory_manager on public.goods_receipts;
create policy goods_receipts_select_authorized_scope
on public.goods_receipts for select to authenticated
using (
  (select private.has_permission(organization_id, 'inventory.manage'))
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists goods_receipt_lines_select_inventory_manager on public.goods_receipt_lines;
create policy goods_receipt_lines_select_authorized_scope
on public.goods_receipt_lines for select to authenticated
using (
  (select private.has_permission(organization_id, 'inventory.manage'))
  and exists (
    select 1
    from public.goods_receipts goods_receipt
    where goods_receipt.id = goods_receipt_lines.goods_receipt_id
      and goods_receipt.organization_id = goods_receipt_lines.organization_id
      and (select private.has_store_read_scope(goods_receipt.organization_id, goods_receipt.store_id))
  )
);

commit;
