begin;

-- Resolve the authenticated inventory actor through the same central store-scope
-- rule used by Back Office and RLS. Organization-wide store managers (including
-- the preset Owner bundle) do not require one employee_stores row per branch;
-- store-scoped custom roles still require an explicit assignment.
create or replace function private.inventory_actor(
  target_organization_id uuid,
  target_store_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select employee.id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
    and (select private.has_store_read_scope(target_organization_id, target_store_id))
  limit 1;
$$;

-- Transfer children inherit the authorization boundary of their canonical
-- parent request/transfer. These policies expose no new mutation path.
drop policy if exists stock_transfer_receipts_select_manager on public.stock_transfer_receipts;
create policy stock_transfer_receipts_select_manager
  on public.stock_transfer_receipts
  for select
  to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_stock_transfer_read_scope(organization_id, stock_transfer_id))
  );

drop policy if exists stock_transfer_receipt_lines_select_manager on public.stock_transfer_receipt_lines;
create policy stock_transfer_receipt_lines_select_manager
  on public.stock_transfer_receipt_lines
  for select
  to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and exists (
      select 1
      from public.stock_transfer_receipts receipt
      where receipt.id = stock_transfer_receipt_lines.stock_transfer_receipt_id
        and receipt.organization_id = stock_transfer_receipt_lines.organization_id
        and (select private.has_stock_transfer_read_scope(receipt.organization_id, receipt.stock_transfer_id))
    )
  );

drop policy if exists stock_request_discrepancies_select_inventory_manager on public.stock_request_discrepancies;
create policy stock_request_discrepancies_select_inventory_manager
  on public.stock_request_discrepancies
  for select
  to authenticated
  using (
    (select private.has_permission(organization_id, 'inventory.manage'))
    and (select private.has_stock_request_read_scope(organization_id, stock_request_id))
  );

revoke all on function private.inventory_actor(uuid, uuid)
from public, anon, authenticated, service_role;

comment on function private.inventory_actor(uuid, uuid)
is 'Returns the active authenticated employee when the central capability/store-scope model authorizes the target store. Organization-wide stores.manage roles do not require per-store assignments.';

commit;
