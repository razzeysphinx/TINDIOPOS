-- Phase 5: direct store transfers use the existing transfer, receipt, ledger,
-- and audit records. Replenishment requests retain their approval-aware path;
-- direct transfers intentionally start at in_transit.
begin;

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
  source_level public.inventory_levels%rowtype;
  product_row record;
  line jsonb;
  transfer_id uuid;
  transfer_number bigint;
  normalized_note text;
  requested_payload jsonb;
  persisted_payload jsonb;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable transfer operation ID is required.' using errcode = '23514';
  end if;

  if target_source_store_id is null
     or target_destination_store_id is null
     or target_source_store_id = target_destination_store_id
     or target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100
     or (target_note is not null and char_length(btrim(target_note)) > 500) then
    raise exception 'Choose two different stores, one to 100 items, and a valid note.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) transfer_line(value)
    where jsonb_typeof(transfer_line.value) <> 'object'
      or coalesce(transfer_line.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (nullif(transfer_line.value ->> 'variant_id', '') is not null
        and nullif(transfer_line.value ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or coalesce(transfer_line.value ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or (transfer_line.value ->> 'quantity')::numeric <= 0
  )
  or (select count(*) from jsonb_array_elements(target_lines)) <> (
    select count(distinct format('%s|%s', value ->> 'product_id', coalesce(nullif(value ->> 'variant_id', ''), '')))
    from jsonb_array_elements(target_lines)
  ) then
    raise exception 'Transfer lines must contain unique, valid items and positive quantities.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'variant_id', normalized.variant_id,
        'quantity', normalized.quantity
      )
      order by normalized.product_id, normalized.variant_id
    ),
    '[]'::jsonb
  )
  into requested_payload
  from (
    select
      lower(btrim(value ->> 'product_id')) as product_id,
      nullif(lower(btrim(value ->> 'variant_id')), '') as variant_id,
      ((value ->> 'quantity')::numeric(14,3))::text as quantity
    from jsonb_array_elements(target_lines)
  ) normalized;

  if not exists (
    select 1
    from public.stores store
    where store.organization_id = target_organization_id
      and store.id = target_source_store_id
      and store.is_active
  ) or not exists (
    select 1
    from public.stores store
    where store.organization_id = target_organization_id
      and store.id = target_destination_store_id
      and store.is_active
  ) then
    raise exception 'Choose active source and destination stores in this organization.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_source_store_id);
  destination_actor_id := private.inventory_actor(target_organization_id, target_destination_store_id);
  if actor_id is null or destination_actor_id is null then
    raise exception 'An active employee with access to both stores is required for this transfer.' using errcode = '42501';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  select *
  into existing_transfer
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
        )
        order by existing_line.product_id, existing_line.variant_id
      ),
      '[]'::jsonb
    )
    into persisted_payload
    from public.stock_transfer_lines existing_line
    where existing_line.organization_id = target_organization_id
      and existing_line.stock_transfer_id = existing_transfer.id;

    if existing_transfer.stock_request_id is null
       and existing_transfer.source_store_id = target_source_store_id
       and existing_transfer.destination_store_id = target_destination_store_id
       and existing_transfer.transferred_by_employee_id = actor_id
       and existing_transfer.note is not distinct from normalized_note
       and persisted_payload = requested_payload then
      return existing_transfer.id;
    end if;

    raise exception 'This operation ID is already assigned to a different transfer.' using errcode = '23505';
  end if;

  transfer_number := nextval('private.tindio_stock_transfer_number_sequence'::regclass);
  insert into public.stock_transfers (
    organization_id,
    transfer_number,
    operation_id,
    source_store_id,
    destination_store_id,
    stock_request_id,
    status,
    note,
    transferred_by_employee_id
  )
  values (
    target_organization_id,
    transfer_number,
    target_operation_id,
    target_source_store_id,
    target_destination_store_id,
    null,
    'in_transit',
    normalized_note,
    actor_id
  )
  returning id into transfer_id;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    select product.id, product.name, variant.id as variant_id
    into product_row
    from public.products product
    left join public.product_variants variant
      on variant.id = nullif(line ->> 'variant_id', '')::uuid
      and variant.product_id = product.id
      and variant.organization_id = product.organization_id
      and variant.is_active
    where product.id = (line ->> 'product_id')::uuid
      and product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
      and (nullif(line ->> 'variant_id', '') is null or variant.id is not null);

    if product_row.id is null then
      raise exception 'Every transfer item must be an active tracked product in this organization.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.product_store_settings setting
      where setting.organization_id = target_organization_id
        and setting.product_id = product_row.id
        and setting.store_id in (target_source_store_id, target_destination_store_id)
        and setting.is_available
      group by setting.product_id
      having count(*) = 2
    ) then
      raise exception 'Each transfer item must be available in both stores.' using errcode = '23514';
    end if;

    select *
    into source_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_source_store_id
      and level.product_id = product_row.id
      and level.variant_id is not distinct from nullif(line ->> 'variant_id', '')::uuid
    for update;

    if source_level.id is null
       or source_level.quantity < (line ->> 'quantity')::numeric(14,3) then
      raise exception 'Source stock is insufficient for this transfer.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id = target_destination_store_id
        and level.product_id = product_row.id
        and level.variant_id is not distinct from nullif(line ->> 'variant_id', '')::uuid
    ) then
      raise exception 'The destination stock projection is not initialized for one transfer item.' using errcode = '23514';
    end if;

    insert into public.stock_transfer_lines (
      organization_id,
      stock_transfer_id,
      stock_request_line_id,
      product_id,
      variant_id,
      quantity,
      unit_cost_minor
    )
    values (
      target_organization_id,
      transfer_id,
      null,
      product_row.id,
      nullif(line ->> 'variant_id', '')::uuid,
      (line ->> 'quantity')::numeric(14,3),
      source_level.average_cost_minor
    );

    -- Transfers always require real source stock. The POS negative-stock
    -- policy is deliberately not consulted for this operational command.
    perform private.apply_inventory_change_v2(
      target_organization_id,
      target_source_store_id,
      product_row.id,
      nullif(line ->> 'variant_id', '')::uuid,
      -(line ->> 'quantity')::numeric(14,3),
      'TRANSFER_OUT',
      actor_id,
      format('Direct transfer TR-%s sent', lpad(transfer_number::text, 6, '0')),
      'stock_transfer',
      transfer_id,
      source_level.average_cost_minor
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id,
    'STOCK_TRANSFER_SENT',
    'inventory.manage',
    actor_id,
    null,
    target_source_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'stock_transfer_id', transfer_id,
      'transfer_number', transfer_number,
      'source_store_id', target_source_store_id,
      'destination_store_id', target_destination_store_id,
      'operation_id', target_operation_id,
      'lines', requested_payload
    )
  );

  return transfer_id;
end;
$$;

create or replace function public.create_direct_stock_transfer(
  target_organization_id uuid,
  target_source_store_id uuid,
  target_destination_store_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_direct_stock_transfer(
    target_organization_id,
    target_source_store_id,
    target_destination_store_id,
    target_lines,
    target_note,
    target_operation_id
  );
$$;

-- Generic receipts continue to serve direct transfers (stock_request_id is
-- null). Request-linked transfers remain routed to receive_stock_request so
-- their request-level discrepancy records cannot be bypassed.
create or replace function private.receive_stock_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
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
  transfer public.stock_transfers%rowtype;
  existing_receipt public.stock_transfer_receipts%rowtype;
  actor_id uuid;
  receipt_id uuid;
  receipt_number bigint;
  line jsonb;
  transfer_line public.stock_transfer_lines%rowtype;
  received_now numeric(14,3);
  short_now numeric(14,3);
  remaining numeric(14,3);
  total_remaining numeric(14,3);
  has_shortage boolean;
  normalized_note text;
  requested_payload jsonb;
  uses_legacy_line_shape boolean;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable transfer-receipt operation ID is required.' using errcode = '23514';
  end if;

  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100
     or (target_note is not null and char_length(btrim(target_note)) > 500) then
    raise exception 'A transfer receipt needs one to 100 items and a valid note.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) receipt(value)
    where jsonb_typeof(receipt.value) <> 'object'
      or coalesce(receipt.value ->> 'stock_transfer_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(receipt.value ->> 'received_quantity', receipt.value ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or coalesce(receipt.value ->> 'short_quantity', '0') !~ '^\d+(\.\d{1,3})?$'
      or ((coalesce(receipt.value ->> 'received_quantity', receipt.value ->> 'quantity'))::numeric
        + (coalesce(receipt.value ->> 'short_quantity', '0'))::numeric) <= 0
      or ((coalesce(receipt.value ->> 'short_quantity', '0'))::numeric > 0
        and char_length(btrim(coalesce(receipt.value ->> 'discrepancy_note', ''))) not between 2 and 500)
  )
  or (select count(*) from jsonb_array_elements(target_lines)) <> (
    select count(distinct value ->> 'stock_transfer_line_id') from jsonb_array_elements(target_lines)
  ) then
    raise exception 'Receipt lines, quantities, and discrepancy notes are invalid.' using errcode = '23514';
  end if;

  select bool_and(not (value ? 'received_quantity') and not (value ? 'short_quantity') and not (value ? 'discrepancy_note'))
  into uses_legacy_line_shape
  from jsonb_array_elements(target_lines);

  if uses_legacy_line_shape then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stock_transfer_line_id', normalized.stock_transfer_line_id,
          'quantity', normalized.received_quantity
        )
        order by normalized.stock_transfer_line_id
      ),
      '[]'::jsonb
    )
    into requested_payload
    from (
      select
        lower(btrim(value ->> 'stock_transfer_line_id')) as stock_transfer_line_id,
        ((value ->> 'quantity')::numeric(14,3))::text as received_quantity
      from jsonb_array_elements(target_lines)
    ) normalized;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stock_transfer_line_id', normalized.stock_transfer_line_id,
          'received_quantity', normalized.received_quantity,
          'short_quantity', normalized.short_quantity,
          'discrepancy_note', normalized.discrepancy_note
        )
        order by normalized.stock_transfer_line_id
      ),
      '[]'::jsonb
    )
    into requested_payload
    from (
      select
        lower(btrim(value ->> 'stock_transfer_line_id')) as stock_transfer_line_id,
        ((coalesce(value ->> 'received_quantity', value ->> 'quantity'))::numeric(14,3))::text as received_quantity,
        ((coalesce(value ->> 'short_quantity', '0'))::numeric(14,3))::text as short_quantity,
        nullif(btrim(coalesce(value ->> 'discrepancy_note', '')), '') as discrepancy_note
      from jsonb_array_elements(target_lines)
    ) normalized;
  end if;

  normalized_note := nullif(btrim(target_note), '');
  select *
  into transfer
  from public.stock_transfers item
  where item.id = target_stock_transfer_id
    and item.organization_id = target_organization_id
  for update;

  if transfer.id is null then
    raise exception 'Choose a transfer in this organization.' using errcode = '23514';
  end if;

  if transfer.stock_request_id is not null then
    raise exception 'Receive replenishment transfers from the stock request workflow so shortages stay traceable.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, transfer.destination_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for the destination store.' using errcode = '42501';
  end if;

  select *
  into existing_receipt
  from public.stock_transfer_receipts receipt
  where receipt.organization_id = target_organization_id
    and receipt.operation_id = target_operation_id
  for update;

  if found then
    if existing_receipt.stock_transfer_id = transfer.id
       and existing_receipt.destination_store_id = transfer.destination_store_id
       and existing_receipt.received_by_employee_id = actor_id
       and existing_receipt.note is not distinct from normalized_note
       and existing_receipt.operation_payload = requested_payload then
      return existing_receipt.id;
    end if;

    raise exception 'This operation ID is already assigned to a different transfer receipt.' using errcode = '23505';
  end if;

  if transfer.status not in ('in_transit', 'partially_received') then
    raise exception 'This transfer is not available for receiving.' using errcode = '23514';
  end if;

  receipt_number := nextval('private.tindio_stock_transfer_receipt_number_sequence'::regclass);
  insert into public.stock_transfer_receipts (
    organization_id,
    receipt_number,
    operation_id,
    operation_payload,
    stock_transfer_id,
    destination_store_id,
    received_by_employee_id,
    note
  )
  values (
    target_organization_id,
    receipt_number,
    target_operation_id,
    requested_payload,
    transfer.id,
    transfer.destination_store_id,
    actor_id,
    normalized_note
  )
  returning id into receipt_id;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    select *
    into transfer_line
    from public.stock_transfer_lines item
    where item.id = (line ->> 'stock_transfer_line_id')::uuid
      and item.stock_transfer_id = transfer.id
      and item.organization_id = target_organization_id
      and item.stock_request_line_id is null
    for update;

    if transfer_line.id is null then
      raise exception 'A receipt line does not belong to this direct transfer.' using errcode = '23514';
    end if;

    received_now := (coalesce(line ->> 'received_quantity', line ->> 'quantity'))::numeric(14,3);
    short_now := (coalesce(line ->> 'short_quantity', '0'))::numeric(14,3);
    remaining := transfer_line.quantity - transfer_line.received_quantity - transfer_line.short_quantity;
    if received_now + short_now > remaining then
      raise exception 'Received and short quantities cannot exceed the remaining sent quantity.' using errcode = '23514';
    end if;

    if received_now > 0 then
      insert into public.stock_transfer_receipt_lines (
        organization_id,
        stock_transfer_receipt_id,
        stock_transfer_line_id,
        quantity_received
      )
      values (target_organization_id, receipt_id, transfer_line.id, received_now);

      perform private.apply_inventory_change_v2(
        target_organization_id,
        transfer.destination_store_id,
        transfer_line.product_id,
        transfer_line.variant_id,
        received_now,
        'TRANSFER_IN',
        actor_id,
        format('Transfer TR-%s receipt %s', lpad(transfer.transfer_number::text, 6, '0'), lpad(receipt_number::text, 6, '0')),
        'stock_transfer_receipt',
        receipt_id,
        transfer_line.unit_cost_minor
      );
    end if;

    update public.stock_transfer_lines
    set received_quantity = received_quantity + received_now,
        short_quantity = short_quantity + short_now
    where id = transfer_line.id;
  end loop;

  select coalesce(sum(quantity - received_quantity - short_quantity), 0)
  into total_remaining
  from public.stock_transfer_lines
  where stock_transfer_id = transfer.id;

  select exists (
    select 1
    from public.stock_transfer_lines
    where stock_transfer_id = transfer.id
      and short_quantity > 0
  )
  into has_shortage;

  update public.stock_transfers
  set status = case when total_remaining = 0 then 'completed' else 'partially_received' end,
      received_by_employee_id = actor_id,
      received_at = now(),
      completed_at = case when total_remaining = 0 then now() else completed_at end
  where id = transfer.id;

  perform private.write_audit_log(
    target_organization_id,
    case when total_remaining = 0 then 'STOCK_TRANSFER_RECEIVED' else 'STOCK_TRANSFER_PARTIALLY_RECEIVED' end,
    'inventory.manage',
    actor_id,
    null,
    transfer.destination_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'stock_transfer_id', transfer.id,
      'transfer_number', transfer.transfer_number,
      'receipt_id', receipt_id,
      'receipt_number', receipt_number,
      'remaining_quantity', total_remaining,
      'has_discrepancy', has_shortage,
      'receipt_lines', requested_payload
    )
  );
  return receipt_id;
end;
$$;

revoke execute on function private.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid)
from public, anon, service_role;
revoke execute on function public.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid)
from public, anon, service_role;
grant execute on function private.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid)
to authenticated;
grant execute on function public.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid)
to authenticated;

comment on function public.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid) is
  'Creates an immediately in-transit direct store transfer. It validates both store scopes, deducts only source stock, and is retry-safe by organization operation ID.';
comment on function public.receive_stock_transfer(uuid, uuid, jsonb, text, uuid) is
  'Receives direct transfers only. Quantities and shortages are bounded by the remaining sent stock and destination ledger entries are created only for received quantity.';

commit;
