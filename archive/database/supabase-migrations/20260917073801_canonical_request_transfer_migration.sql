-- Phase 06: migrate request-backed physical transfers onto the canonical engine.
begin;

create or replace function private.dispatch_inventory_transfer_core(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_note text,
  target_operation_id uuid,
  allow_request_transfer boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  existing_operation private.stock_transfer_operations%rowtype;
  normalized_note text := nullif(btrim(target_note), '');
  operation_payload jsonb;
  source_level public.inventory_levels%rowtype;
  transfer public.stock_transfers%rowtype;
  transfer_line public.stock_transfer_lines%rowtype;
  line_count integer := 0;
begin
  if target_operation_id is null then raise exception 'A stable dispatch operation ID is required.' using errcode = '23514'; end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then raise exception 'The transfer note is too long.' using errcode = '23514'; end if;
  operation_payload := jsonb_build_object('stock_transfer_id', target_stock_transfer_id, 'note', normalized_note);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into existing_operation from private.stock_transfer_operations operation
   where operation.organization_id = target_organization_id and operation.operation_id = target_operation_id for update;
  if found then
    if existing_operation.command = 'dispatch' and existing_operation.normalized_payload = operation_payload then return existing_operation.result_id; end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;
  select * into transfer from public.stock_transfers item
   where item.organization_id = target_organization_id and item.id = target_stock_transfer_id for update;
  if transfer.id is null or (transfer.stock_request_id is not null) <> allow_request_transfer then
    raise exception 'Choose a transfer in the expected workflow.' using errcode = '23514';
  end if;
  if transfer.status <> 'approved' then raise exception 'Only an approved transfer can be dispatched.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, transfer.source_store_id);
  if actor_id is null then raise exception 'An active employee assigned to the source store is required.' using errcode = '42501'; end if;
  for transfer_line in
    select * from public.stock_transfer_lines line
     where line.organization_id = target_organization_id and line.stock_transfer_id = transfer.id
       and ((allow_request_transfer and line.stock_request_line_id is not null) or (not allow_request_transfer and line.stock_request_line_id is null))
     order by line.product_id, line.variant_id nulls first for update
  loop
    line_count := line_count + 1;
    select * into source_level from public.inventory_levels level
     where level.organization_id = target_organization_id and level.store_id = transfer.source_store_id
       and level.product_id = transfer_line.product_id and level.variant_id is not distinct from transfer_line.variant_id for update;
    if source_level.id is null or source_level.quantity < transfer_line.quantity then raise exception 'Source stock is insufficient for this transfer.' using errcode = '23514'; end if;
    if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id
      and level.store_id = transfer.destination_store_id and level.product_id = transfer_line.product_id
      and level.variant_id is not distinct from transfer_line.variant_id) then
      raise exception 'The destination stock projection is not initialized for one transfer item.' using errcode = '23514';
    end if;
    update public.stock_transfer_lines set unit_cost_minor = source_level.average_cost_minor,
      unit_cost_is_known = source_level.cost_is_known where id = transfer_line.id;
    perform private.apply_inventory_change_v2(target_organization_id, transfer.source_store_id,
      transfer_line.product_id, transfer_line.variant_id, -transfer_line.quantity, 'TRANSFER_OUT', actor_id,
      format('Transfer TR-%s dispatched', lpad(transfer.transfer_number::text, 6, '0')),
      'stock_transfer', transfer.id, source_level.average_cost_minor);
  end loop;
  if line_count = 0 then raise exception 'A transfer must contain at least one eligible transfer line.' using errcode = '23514'; end if;
  update public.stock_transfers set status = 'dispatched' where id = transfer.id;
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command,
    normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer.id, target_operation_id, 'dispatch', operation_payload,
    'approved', 'dispatched', actor_id, transfer.id, normalized_note);
  perform private.write_audit_log(target_organization_id, 'STOCK_TRANSFER_DISPATCHED', 'inventory.transfer.send', actor_id,
    null, transfer.source_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_transfer_id', transfer.id, 'transfer_number', transfer.transfer_number, 'operation_id', target_operation_id));
  return transfer.id;
end;
$$;

create or replace function private.dispatch_inventory_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid, target_note text, target_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare transfer public.stock_transfers%rowtype;
begin
  select * into transfer from public.stock_transfers where organization_id = target_organization_id and id = target_stock_transfer_id;
  if transfer.id is null or transfer.stock_request_id is not null then raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514'; end if;
  if (select auth.uid()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send')) then
    raise exception 'Transfer send permission is required.' using errcode = '42501';
  end if;
  return private.dispatch_inventory_transfer_core(target_organization_id, target_stock_transfer_id, target_note, target_operation_id, false);
end;
$$;

create or replace function private.dispatch_stock_request(
  target_organization_id uuid, target_stock_request_id uuid, target_note text, target_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_row public.stock_requests%rowtype;
  existing_transfer public.stock_transfers%rowtype;
  request_line public.stock_request_lines%rowtype;
  actor_id uuid; warehouse_store_id uuid; transfer_id uuid; transfer_number bigint;
  normalized_note text := nullif(btrim(target_note), '');
  effective_note text;
  create_payload jsonb; transition_payload jsonb;
  submit_id uuid; approve_id uuid; dispatch_id uuid;
begin
  if (select auth.uid()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send')) then
    raise exception 'Transfer send permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then raise exception 'A stable transfer-dispatch operation ID is required.' using errcode = '23514'; end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then raise exception 'Dispatch note is too long.' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into request_row from public.stock_requests item
   where item.id = target_stock_request_id and item.organization_id = target_organization_id for update;
  if request_row.id is null then raise exception 'Choose a stock request in this organization.' using errcode = '23514'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse
   where warehouse.id = request_row.source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501'; end if;
  effective_note := coalesce(normalized_note, request_row.note);
  select * into existing_transfer from public.stock_transfers transfer
   where transfer.organization_id = target_organization_id and transfer.operation_id = target_operation_id for update;
  if found then
    if existing_transfer.stock_request_id = request_row.id and existing_transfer.source_store_id = warehouse_store_id
      and existing_transfer.destination_store_id = request_row.requesting_store_id
      and existing_transfer.transferred_by_employee_id = actor_id and existing_transfer.note is not distinct from effective_note then return existing_transfer.id; end if;
    raise exception 'This operation ID is already assigned to a different transfer dispatch.' using errcode = '23505';
  end if;
  if request_row.status <> 'picking' then raise exception 'Only a picked request can be dispatched.' using errcode = '23514'; end if;
  transfer_number := nextval('private.tindio_stock_transfer_number_sequence'::regclass);
  insert into public.stock_transfers (organization_id, transfer_number, operation_id, source_store_id,
    destination_store_id, stock_request_id, status, note, transferred_by_employee_id)
  values (target_organization_id, transfer_number, target_operation_id, warehouse_store_id,
    request_row.requesting_store_id, request_row.id, 'draft', effective_note, actor_id) returning id into transfer_id;
  for request_line in select * from public.stock_request_lines item
    where item.stock_request_id = request_row.id and item.picked_quantity > 0 order by item.product_id, item.variant_id
  loop
    insert into public.stock_transfer_lines (organization_id, stock_transfer_id, stock_request_line_id,
      product_id, variant_id, quantity, unit_cost_minor, unit_cost_is_known)
    values (target_organization_id, transfer_id, request_line.id, request_line.product_id,
      request_line.variant_id, request_line.picked_quantity, 0, false);
  end loop;
  if not found then raise exception 'A picked request must contain at least one item.' using errcode = '23514'; end if;
  create_payload := jsonb_build_object('stock_request_id', request_row.id, 'source_store_id', warehouse_store_id,
    'destination_store_id', request_row.requesting_store_id, 'note', effective_note);
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command,
    normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer_id, target_operation_id, 'create', create_payload, null, 'draft', actor_id, transfer_id, effective_note);
  submit_id := private.inventory_transfer_child_operation_id(target_operation_id, 'submit');
  approve_id := private.inventory_transfer_child_operation_id(target_operation_id, 'approve');
  dispatch_id := private.inventory_transfer_child_operation_id(target_operation_id, 'dispatch');
  transition_payload := jsonb_build_object('stock_transfer_id', transfer_id, 'note', normalized_note);
  update public.stock_transfers set status = 'submitted' where id = transfer_id;
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command, normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer_id, submit_id, 'submit', transition_payload, 'draft', 'submitted', actor_id, transfer_id, normalized_note);
  update public.stock_transfers set status = 'approved' where id = transfer_id;
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command, normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer_id, approve_id, 'approve', transition_payload, 'submitted', 'approved', actor_id, transfer_id, normalized_note);
  perform private.dispatch_inventory_transfer_core(target_organization_id, transfer_id, normalized_note, dispatch_id, true);
  update public.stock_request_lines set dispatched_quantity = picked_quantity where stock_request_id = request_row.id and picked_quantity > 0;
  update public.stock_requests set status = 'dispatched', dispatched_by_employee_id = actor_id, dispatched_at = now() where id = request_row.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_DISPATCHED', 'inventory.transfer.send', actor_id,
    null, warehouse_store_id, null, null, null, effective_note,
    jsonb_build_object('stock_request_id', request_row.id, 'request_number', request_row.request_number,
      'stock_transfer_id', transfer_id, 'transfer_number', transfer_number, 'destination_store_id', request_row.requesting_store_id));
  return transfer_id;
end;
$$;

create or replace function private.receive_inventory_transfer_core(
  target_organization_id uuid, target_stock_transfer_id uuid, target_lines jsonb,
  target_note text, target_operation_id uuid, allow_request_transfer boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid; command_payload jsonb; existing_operation private.stock_transfer_operations%rowtype;
  existing_receipt public.stock_transfer_receipts%rowtype; from_status text; has_shortage boolean;
  line jsonb; normalized_lines jsonb; normalized_note text := nullif(btrim(target_note), '');
  receipt_id uuid; receipt_number bigint; received_now numeric(14,3); remaining numeric(14,3);
  short_now numeric(14,3); to_status text; total_remaining numeric(14,3);
  transfer public.stock_transfers%rowtype; transfer_line public.stock_transfer_lines%rowtype;
begin
  if target_operation_id is null then raise exception 'A stable transfer-receipt operation ID is required.' using errcode = '23514'; end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then raise exception 'The transfer receipt note is too long.' using errcode = '23514'; end if;
  normalized_lines := private.normalize_inventory_transfer_receipt_lines(target_lines);
  command_payload := jsonb_build_object('stock_transfer_id', target_stock_transfer_id, 'note', normalized_note, 'lines', normalized_lines);
  select * into transfer from public.stock_transfers item where item.organization_id = target_organization_id and item.id = target_stock_transfer_id;
  if transfer.id is null or (transfer.stock_request_id is not null) <> allow_request_transfer then
    raise exception 'Choose a transfer in the expected workflow.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, transfer.destination_store_id);
  if actor_id is null then raise exception 'An active employee assigned to the destination store is required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into existing_operation from private.stock_transfer_operations operation
   where operation.organization_id = target_organization_id and operation.operation_id = target_operation_id for update;
  if found then
    if existing_operation.command = 'receive' and existing_operation.normalized_payload = command_payload then return existing_operation.result_id; end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;
  select * into existing_receipt from public.stock_transfer_receipts receipt
   where receipt.organization_id = target_organization_id and receipt.operation_id = target_operation_id for update;
  if found then
    if existing_receipt.stock_transfer_id = transfer.id and existing_receipt.destination_store_id = transfer.destination_store_id
      and existing_receipt.received_by_employee_id = actor_id and existing_receipt.note is not distinct from normalized_note
      and existing_receipt.operation_payload = normalized_lines then return existing_receipt.id; end if;
    raise exception 'This operation ID is already assigned to a different transfer receipt.' using errcode = '23505';
  end if;
  select * into transfer from public.stock_transfers item
   where item.organization_id = target_organization_id and item.id = target_stock_transfer_id for update;
  if transfer.status not in ('dispatched', 'partially_received') then raise exception 'This transfer is not available for receiving.' using errcode = '23514'; end if;
  from_status := transfer.status;
  receipt_number := nextval('private.tindio_stock_transfer_receipt_number_sequence'::regclass);
  insert into public.stock_transfer_receipts (organization_id, receipt_number, operation_id, operation_payload,
    stock_transfer_id, destination_store_id, received_by_employee_id, note)
  values (target_organization_id, receipt_number, target_operation_id, normalized_lines,
    transfer.id, transfer.destination_store_id, actor_id, normalized_note) returning id into receipt_id;
  for line in select value from jsonb_array_elements(normalized_lines) order by value ->> 'stock_transfer_line_id'
  loop
    select * into transfer_line from public.stock_transfer_lines item
     where item.id = (line ->> 'stock_transfer_line_id')::uuid and item.stock_transfer_id = transfer.id
       and item.organization_id = target_organization_id
       and ((allow_request_transfer and item.stock_request_line_id is not null) or (not allow_request_transfer and item.stock_request_line_id is null)) for update;
    if transfer_line.id is null then raise exception 'A receipt line does not belong to this transfer workflow.' using errcode = '23514'; end if;
    received_now := coalesce(line ->> 'received_quantity', line ->> 'quantity')::numeric(14,3);
    short_now := coalesce(line ->> 'short_quantity', '0')::numeric(14,3);
    remaining := transfer_line.quantity - transfer_line.received_quantity - transfer_line.short_quantity;
    if received_now + short_now > remaining then raise exception 'Received and short quantities cannot exceed the remaining dispatched quantity.' using errcode = '23514'; end if;
    if received_now > 0 then
      insert into public.stock_transfer_receipt_lines (organization_id, stock_transfer_receipt_id, stock_transfer_line_id, quantity_received)
      values (target_organization_id, receipt_id, transfer_line.id, received_now);
      perform private.apply_inventory_change_v2(target_organization_id, transfer.destination_store_id,
        transfer_line.product_id, transfer_line.variant_id, received_now, 'TRANSFER_IN', actor_id,
        format('Transfer TR-%s receipt %s', lpad(transfer.transfer_number::text, 6, '0'), lpad(receipt_number::text, 6, '0')),
        'stock_transfer_receipt', receipt_id, transfer_line.unit_cost_minor);
    end if;
    update public.stock_transfer_lines set received_quantity = received_quantity + received_now,
      short_quantity = short_quantity + short_now where id = transfer_line.id;
  end loop;
  select coalesce(sum(quantity - received_quantity - short_quantity), 0) into total_remaining
    from public.stock_transfer_lines where stock_transfer_id = transfer.id;
  select exists(select 1 from public.stock_transfer_lines where stock_transfer_id = transfer.id and short_quantity > 0) into has_shortage;
  to_status := case when total_remaining = 0 then 'received' else 'partially_received' end;
  update public.stock_transfers set status = to_status, received_by_employee_id = actor_id, received_at = now(),
    completed_at = case when total_remaining = 0 then now() else completed_at end where id = transfer.id;
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command,
    normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer.id, target_operation_id, 'receive', command_payload,
    from_status, to_status, actor_id, receipt_id, normalized_note);
  perform private.write_audit_log(target_organization_id,
    case when total_remaining = 0 then 'STOCK_TRANSFER_RECEIVED' else 'STOCK_TRANSFER_PARTIALLY_RECEIVED' end,
    'inventory.transfer.receive', actor_id, null, transfer.destination_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_transfer_id', transfer.id, 'transfer_number', transfer.transfer_number,
      'receipt_id', receipt_id, 'receipt_number', receipt_number, 'operation_id', target_operation_id,
      'remaining_quantity', total_remaining, 'has_discrepancy', has_shortage, 'receipt_lines', normalized_lines));
  return receipt_id;
end;
$$;

create or replace function private.receive_inventory_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid, target_lines jsonb,
  target_note text, target_operation_id uuid, allow_legacy_in_transit boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare transfer public.stock_transfers%rowtype;
begin
  select * into transfer from public.stock_transfers where organization_id = target_organization_id and id = target_stock_transfer_id;
  if transfer.id is null then raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514'; end if;
  if transfer.stock_request_id is not null then raise exception 'Receive replenishment transfers from the stock request workflow so shortages stay traceable.' using errcode = '23514'; end if;
  if (select auth.uid()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive')) then
    raise exception 'Transfer receive permission is required.' using errcode = '42501';
  end if;
  return private.receive_inventory_transfer_core(target_organization_id, target_stock_transfer_id, target_lines, target_note, target_operation_id, false);
end;
$$;

create or replace function private.receive_stock_request(
  target_organization_id uuid, target_stock_request_id uuid, target_lines jsonb,
  target_note text, target_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_row public.stock_requests%rowtype; transfer_row public.stock_transfers%rowtype;
  existing_receipt public.stock_transfer_receipts%rowtype; transfer_line public.stock_transfer_lines%rowtype;
  request_line public.stock_request_lines%rowtype; actor_id uuid; receipt_id uuid; line jsonb;
  received_now numeric(14,3); short_now numeric(14,3); total_remaining numeric(14,3); has_shortage boolean;
  normalized_note text := nullif(btrim(target_note), ''); normalized_lines jsonb;
begin
  if (select auth.uid()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive')) then
    raise exception 'Transfer receive permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then raise exception 'A stable transfer-receipt operation ID is required.' using errcode = '23514'; end if;
  normalized_lines := private.normalize_inventory_transfer_receipt_lines(target_lines);
  select * into request_row from public.stock_requests item
   where item.id = target_stock_request_id and item.organization_id = target_organization_id for update;
  if request_row.id is null then raise exception 'Choose a stock request in this organization.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, request_row.requesting_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501'; end if;
  select * into transfer_row from public.stock_transfers transfer
   where transfer.organization_id = target_organization_id and transfer.stock_request_id = request_row.id for update;
  if transfer_row.id is null then raise exception 'The dispatched stock transfer is unavailable.' using errcode = '23514'; end if;
  select * into existing_receipt from public.stock_transfer_receipts receipt
   where receipt.organization_id = target_organization_id and receipt.operation_id = target_operation_id for update;
  if found then
    if existing_receipt.stock_transfer_id = transfer_row.id and existing_receipt.destination_store_id = request_row.requesting_store_id
      and existing_receipt.received_by_employee_id = actor_id and existing_receipt.note is not distinct from normalized_note
      and existing_receipt.operation_payload = normalized_lines then return request_row.id; end if;
    raise exception 'This operation ID is already assigned to a different transfer receipt.' using errcode = '23505';
  end if;
  if request_row.status not in ('dispatched', 'partially_received') or transfer_row.status not in ('dispatched', 'partially_received') then
    raise exception 'This request is not available for receiving.' using errcode = '23514';
  end if;
  receipt_id := private.receive_inventory_transfer_core(target_organization_id, transfer_row.id, target_lines, target_note, target_operation_id, true);
  for line in select value from jsonb_array_elements(target_lines)
  loop
    select * into transfer_line from public.stock_transfer_lines item where item.id = (line ->> 'stock_transfer_line_id')::uuid
      and item.stock_transfer_id = transfer_row.id and item.organization_id = target_organization_id and item.stock_request_line_id is not null;
    select * into request_line from public.stock_request_lines item where item.id = transfer_line.stock_request_line_id
      and item.stock_request_id = request_row.id and item.organization_id = target_organization_id for update;
    received_now := (line ->> 'received_quantity')::numeric(14,3); short_now := (line ->> 'short_quantity')::numeric(14,3);
    update public.stock_request_lines set received_quantity = received_quantity + received_now,
      short_quantity = short_quantity + short_now where id = request_line.id;
    if short_now > 0 then
      if char_length(btrim(coalesce(line ->> 'discrepancy_note', ''))) not between 2 and 500 then raise exception 'A shortage requires a discrepancy note.' using errcode = '23514'; end if;
      insert into public.stock_request_discrepancies (organization_id, stock_request_id, stock_request_line_id,
        stock_transfer_line_id, short_quantity, note, reported_by_employee_id)
      values (target_organization_id, request_row.id, request_line.id, transfer_line.id, short_now,
        btrim(line ->> 'discrepancy_note'), actor_id);
    end if;
  end loop;
  select coalesce(sum(quantity - received_quantity - short_quantity), 0) into total_remaining
    from public.stock_transfer_lines where stock_transfer_id = transfer_row.id;
  select exists(select 1 from public.stock_transfer_lines where stock_transfer_id = transfer_row.id and short_quantity > 0) into has_shortage;
  update public.stock_requests set status = case when total_remaining > 0 then 'partially_received'
      when has_shortage then 'received_with_discrepancy' else 'received' end,
    received_by_employee_id = actor_id, received_at = case when total_remaining = 0 then now() else received_at end
   where id = request_row.id;
  perform private.write_audit_log(target_organization_id,
    case when total_remaining = 0 then 'STOCK_REQUEST_RECEIVED' else 'STOCK_REQUEST_PARTIALLY_RECEIVED' end,
    'inventory.transfer.receive', actor_id, null, request_row.requesting_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_request_id', request_row.id, 'request_number', request_row.request_number,
      'stock_transfer_id', transfer_row.id, 'receipt_id', receipt_id, 'remaining_quantity', total_remaining,
      'has_discrepancy', has_shortage));
  return request_row.id;
end;
$$;

-- Historical rows are converted only when their immutable line accounting is
-- sufficient to prove the canonical state. Unsafe terminal history aborts.
create or replace function private.migrate_legacy_stock_transfer_statuses()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.stock_transfers transfer
    where transfer.status = 'completed'
      and (not exists (select 1 from public.stock_transfer_lines line where line.stock_transfer_id = transfer.id)
        or exists (select 1 from public.stock_transfer_lines line where line.stock_transfer_id = transfer.id
          and line.quantity <> line.received_quantity + line.short_quantity))
  ) then
    raise exception 'Unsafe completed transfer history blocks canonical status cleanup.' using errcode = '23514';
  end if;
  update public.stock_transfers set status = 'dispatched' where status = 'in_transit';
  update public.stock_transfers
  set status = 'received',
      received_by_employee_id = coalesce(received_by_employee_id, transferred_by_employee_id),
      received_at = coalesce(received_at, completed_at)
  where status = 'completed';
  if exists (select 1 from public.stock_transfers where status in ('in_transit', 'completed')) then
    raise exception 'Legacy transfer statuses remain after deterministic cleanup.' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.migrate_legacy_stock_transfer_statuses() from public, anon, authenticated, service_role;
select private.migrate_legacy_stock_transfer_statuses();

alter table public.stock_transfers
  drop constraint stock_transfers_received_state,
  drop constraint stock_transfers_status_values,
  add constraint stock_transfers_status_values check (
    status in ('draft', 'submitted', 'approved', 'dispatched', 'partially_received', 'received', 'cancelled')
  ),
  add constraint stock_transfers_received_state check (
    (status in ('partially_received', 'received') and received_by_employee_id is not null and received_at is not null)
    or (status in ('draft', 'submitted', 'approved', 'dispatched', 'cancelled') and received_by_employee_id is null and received_at is null)
  );

create or replace function public.get_pos_incoming_stock_transfers(target_organization_id uuid)
returns table (transfer_id uuid, transfer_number bigint, stock_request_id uuid, source_store_id uuid,
  source_store_name text, destination_store_id uuid, destination_store_name text, status text, note text, lines jsonb)
language sql stable security definer set search_path = '' as $$
  select transfer.id, transfer.transfer_number, transfer.stock_request_id, transfer.source_store_id, source_store.name,
    transfer.destination_store_id, destination_store.name, transfer.status, transfer.note,
    coalesce(jsonb_agg(jsonb_build_object('id', transfer_line.id,
      'label', product.name || coalesce(' / ' || variant.name, ''), 'unit', product.unit,
      'quantity', transfer_line.quantity, 'received_quantity', transfer_line.received_quantity,
      'short_quantity', transfer_line.short_quantity) order by product.name, variant.name nulls first)
      filter (where transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity), '[]'::jsonb)
  from public.stock_transfers transfer
  join public.stores source_store on source_store.id = transfer.source_store_id and source_store.organization_id = transfer.organization_id
  join public.stores destination_store on destination_store.id = transfer.destination_store_id and destination_store.organization_id = transfer.organization_id
  join public.stock_transfer_lines transfer_line on transfer_line.stock_transfer_id = transfer.id and transfer_line.organization_id = transfer.organization_id
  join public.products product on product.id = transfer_line.product_id and product.organization_id = transfer_line.organization_id
  left join public.product_variants variant on variant.id = transfer_line.variant_id and variant.product_id = transfer_line.product_id
    and variant.organization_id = transfer_line.organization_id
  where (select auth.uid()) is not null
    and exists (select 1 from public.organizations organization where organization.id = target_organization_id and organization.status = 'active')
    and (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive'))
    and exists (select 1 from public.organization_features feature where feature.organization_id = target_organization_id
      and feature.feature_key in ('inventory', 'transfers') and feature.is_enabled group by feature.organization_id having count(*) = 2)
    and transfer.organization_id = target_organization_id
    and transfer.status in ('dispatched', 'partially_received')
    and (select private.has_store_read_scope(target_organization_id, transfer.destination_store_id))
  group by transfer.id, transfer.transfer_number, transfer.stock_request_id, transfer.source_store_id, source_store.name,
    transfer.destination_store_id, destination_store.name, transfer.status, transfer.note
  having bool_or(transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity)
  order by transfer.transfer_number desc;
$$;

revoke all on function private.dispatch_inventory_transfer_core(uuid, uuid, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.receive_inventory_transfer_core(uuid, uuid, jsonb, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.dispatch_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function private.receive_inventory_transfer(uuid, uuid, jsonb, text, uuid, boolean) from public, anon, service_role;
revoke all on function private.dispatch_stock_request(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function private.receive_stock_request(uuid, uuid, jsonb, text, uuid) from public, anon, service_role;
revoke all on function public.get_pos_incoming_stock_transfers(uuid) from public, anon, service_role;
grant execute on function private.dispatch_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function private.receive_inventory_transfer(uuid, uuid, jsonb, text, uuid, boolean) to authenticated;
grant execute on function private.dispatch_stock_request(uuid, uuid, text, uuid) to authenticated;
grant execute on function private.receive_stock_request(uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.get_pos_incoming_stock_transfers(uuid) to authenticated;

comment on function private.dispatch_inventory_transfer_core(uuid, uuid, text, uuid, boolean) is
  'Shared locked canonical physical dispatch core for direct and request adapters; never exposed to API roles.';
comment on function private.receive_inventory_transfer_core(uuid, uuid, jsonb, text, uuid, boolean) is
  'Shared locked canonical physical receipt core for direct and request adapters; never exposed to API roles.';
comment on function public.get_pos_incoming_stock_transfers(uuid) is
  'Returns destination-scoped canonical dispatched and partially received physical transfers for authorized POS receivers.';

notify pgrst, 'reload schema';
commit;
