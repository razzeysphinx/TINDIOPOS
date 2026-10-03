-- POS incoming-transfer inbox.  A transfer document remains the authority;
-- this is a scoped projection for the destination employee, not a second
-- transfer or receipt model.
begin;

create or replace function public.get_pos_incoming_stock_transfers(
  target_organization_id uuid
)
returns table (
  transfer_id uuid,
  transfer_number bigint,
  stock_request_id uuid,
  source_store_id uuid,
  source_store_name text,
  destination_store_id uuid,
  destination_store_name text,
  status text,
  note text,
  lines jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    transfer.id as transfer_id,
    transfer.transfer_number,
    transfer.stock_request_id,
    transfer.source_store_id,
    source_store.name as source_store_name,
    transfer.destination_store_id,
    destination_store.name as destination_store_name,
    transfer.status,
    transfer.note,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', transfer_line.id,
          'label', product.name || coalesce(' / ' || variant.name, ''),
          'unit', product.unit,
          'quantity', transfer_line.quantity,
          'received_quantity', transfer_line.received_quantity,
          'short_quantity', transfer_line.short_quantity
        )
        order by product.name, variant.name nulls first
      ) filter (
        where transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity
      ),
      '[]'::jsonb
    ) as lines
  from public.stock_transfers transfer
  join public.stores source_store
    on source_store.id = transfer.source_store_id
   and source_store.organization_id = transfer.organization_id
  join public.stores destination_store
    on destination_store.id = transfer.destination_store_id
   and destination_store.organization_id = transfer.organization_id
  join public.stock_transfer_lines transfer_line
    on transfer_line.stock_transfer_id = transfer.id
   and transfer_line.organization_id = transfer.organization_id
  join public.products product
    on product.id = transfer_line.product_id
   and product.organization_id = transfer_line.organization_id
  left join public.product_variants variant
    on variant.id = transfer_line.variant_id
   and variant.product_id = transfer_line.product_id
   and variant.organization_id = transfer_line.organization_id
  where (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.status = 'active'
    )
    and (select private.has_inventory_capability(
      target_organization_id,
      'inventory.transfer.receive'
    ))
    and exists (
      select 1
      from public.organization_features feature
      where feature.organization_id = target_organization_id
        and feature.feature_key in ('inventory', 'transfers')
        and feature.is_enabled
      group by feature.organization_id
      having count(*) = 2
    )
    and transfer.organization_id = target_organization_id
    and transfer.status in ('in_transit', 'partially_received')
    and (select private.has_store_read_scope(
      target_organization_id,
      transfer.destination_store_id
    ))
  group by
    transfer.id,
    transfer.transfer_number,
    transfer.stock_request_id,
    transfer.source_store_id,
    source_store.name,
    transfer.destination_store_id,
    destination_store.name,
    transfer.status,
    transfer.note
  having bool_or(
    transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity
  )
  order by transfer.transfer_number desc;
$$;

revoke all on function public.get_pos_incoming_stock_transfers(uuid)
  from public, anon, service_role;
grant execute on function public.get_pos_incoming_stock_transfers(uuid)
  to authenticated;

comment on function public.get_pos_incoming_stock_transfers(uuid) is
  'Returns authoritative, destination-store-scoped incoming transfer documents for authorized POS receivers. The receipt RPC remains the only stock mutation path.';

notify pgrst, 'reload schema';

commit;
