-- Phase 05 post-merge correction: deterministic compatibility-adapter
-- transition identities. Historical Phase 05 migration files remain intact.
begin;

create or replace function private.inventory_transfer_child_operation_id(
  target_parent_operation_id uuid,
  target_command text
)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  digest text;
begin
  if target_command not in ('submit', 'approve', 'dispatch') then
    raise exception 'Unsupported inventory transfer child command.' using errcode = '23514';
  end if;

  digest := md5(
    'tindio:inventory-transfer:'
    || target_parent_operation_id::text
    || ':'
    || target_command
  );

  return (
    substr(digest, 1, 8) || '-'
    || substr(digest, 9, 4) || '-'
    || substr(digest, 13, 4) || '-'
    || substr(digest, 17, 4) || '-'
    || substr(digest, 21, 12)
  )::uuid;
end;
$$;

revoke all on function private.inventory_transfer_child_operation_id(uuid, text)
from public, anon, authenticated, service_role;

create or replace function private.create_direct_stock_transfer(
  target_organization_id uuid,
  target_source_store_id uuid,
  target_destination_store_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  destination_actor_id uuid;
  existing_transfer public.stock_transfers%rowtype;
  normalized_lines jsonb;
  normalized_note text;
  persisted_lines jsonb;
  transfer_id uuid;
begin
  if (select auth.uid()) is null
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.create'))
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send')) then
    raise exception 'Transfer create and send permissions are required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'A stable transfer operation ID is required.' using errcode = '23514';
  end if;
  if target_source_store_id is null
     or target_destination_store_id is null
     or target_source_store_id = target_destination_store_id
     or (target_note is not null and char_length(btrim(target_note)) > 500) then
    raise exception 'Choose two different stores and a valid note.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_source_store_id);
  destination_actor_id := private.inventory_actor(target_organization_id, target_destination_store_id);
  if actor_id is null or destination_actor_id is null then
    raise exception 'An active employee with access to both stores is required for this transfer.' using errcode = '42501';
  end if;
  normalized_note := nullif(btrim(target_note), '');
  normalized_lines := private.normalize_inventory_transfer_lines(target_lines);

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into existing_transfer
  from public.stock_transfers transfer
  where transfer.organization_id = target_organization_id
    and transfer.operation_id = target_operation_id
  for update;
  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', existing_line.product_id,
          'variant_id', existing_line.variant_id,
          'quantity', existing_line.quantity::text
        ) order by existing_line.product_id, existing_line.variant_id
      ),
      '[]'::jsonb
    ) into persisted_lines
    from public.stock_transfer_lines existing_line
    where existing_line.organization_id = target_organization_id
      and existing_line.stock_transfer_id = existing_transfer.id;

    if existing_transfer.stock_request_id is null
       and existing_transfer.source_store_id = target_source_store_id
       and existing_transfer.destination_store_id = target_destination_store_id
       and existing_transfer.transferred_by_employee_id = actor_id
       and existing_transfer.note is not distinct from normalized_note
       and persisted_lines = normalized_lines then
      return existing_transfer.id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer.' using errcode = '23505';
  end if;

  transfer_id := private.create_inventory_transfer_draft(
    target_organization_id,
    target_source_store_id,
    target_destination_store_id,
    normalized_lines,
    normalized_note,
    target_operation_id
  );
  perform private.submit_inventory_transfer(
    target_organization_id,
    transfer_id,
    null,
    private.inventory_transfer_child_operation_id(target_operation_id, 'submit')
  );
  perform private.approve_inventory_transfer(
    target_organization_id,
    transfer_id,
    null,
    private.inventory_transfer_child_operation_id(target_operation_id, 'approve')
  );
  perform private.dispatch_inventory_transfer(
    target_organization_id,
    transfer_id,
    null,
    private.inventory_transfer_child_operation_id(target_operation_id, 'dispatch')
  );
  return transfer_id;
end;
$$;

revoke all on function private.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid)
from public, anon, service_role;
grant execute on function private.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid)
to authenticated;

comment on function private.inventory_transfer_child_operation_id(uuid, text) is
  'Derives deterministic submit, approve, and dispatch operation identities from a direct adapter external operation ID without extension dependencies.';

notify pgrst, 'reload schema';

commit;
