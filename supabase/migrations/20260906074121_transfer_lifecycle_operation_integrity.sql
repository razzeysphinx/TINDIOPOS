-- Phase 3: make the existing stock-request transfer lifecycle retry-safe.
-- Requests plan stock only; dispatch/receipt remain the sole inventory-changing
-- steps and both use the canonical immutable inventory ledger.
begin;

create sequence if not exists private.tindio_stock_transfer_number_sequence;
create sequence if not exists private.tindio_stock_transfer_receipt_number_sequence;
revoke all on sequence private.tindio_stock_transfer_number_sequence from public, anon, authenticated, service_role;
revoke all on sequence private.tindio_stock_transfer_receipt_number_sequence from public, anon, authenticated, service_role;

alter table public.stock_requests
  add column if not exists operation_id uuid;

update public.stock_requests
set operation_id = id
where operation_id is null;

alter table public.stock_requests
  alter column operation_id set not null;

alter table public.stock_requests
  drop constraint if exists stock_requests_organization_operation_unique,
  add constraint stock_requests_organization_operation_unique unique (organization_id, operation_id);

alter table public.stock_transfers
  add column if not exists transfer_number bigint,
  add column if not exists operation_id uuid;

update public.stock_transfers
set transfer_number = nextval('private.tindio_stock_transfer_number_sequence'::regclass)
where transfer_number is null;

update public.stock_transfers
set operation_id = id
where operation_id is null;

alter table public.stock_transfers
  alter column transfer_number set not null,
  alter column operation_id set not null;

alter table public.stock_transfers
  drop constraint if exists stock_transfers_organization_number_unique,
  drop constraint if exists stock_transfers_organization_operation_unique,
  add constraint stock_transfers_organization_number_unique unique (organization_id, transfer_number),
  add constraint stock_transfers_organization_operation_unique unique (organization_id, operation_id);

alter table public.stock_transfer_receipts
  add column if not exists receipt_number bigint,
  add column if not exists operation_id uuid,
  add column if not exists operation_payload jsonb;

update public.stock_transfer_receipts
set receipt_number = nextval('private.tindio_stock_transfer_receipt_number_sequence'::regclass)
where receipt_number is null;

update public.stock_transfer_receipts
set operation_id = id
where operation_id is null;

update public.stock_transfer_receipts
set operation_payload = jsonb_build_object('legacy_receipt_id', id)
where operation_payload is null;

alter table public.stock_transfer_receipts
  alter column receipt_number set not null,
  alter column operation_id set not null,
  alter column operation_payload set not null;

alter table public.stock_transfer_receipts
  drop constraint if exists stock_transfer_receipts_organization_number_unique,
  drop constraint if exists stock_transfer_receipts_organization_operation_unique,
  add constraint stock_transfer_receipts_organization_number_unique unique (organization_id, receipt_number),
  add constraint stock_transfer_receipts_organization_operation_unique unique (organization_id, operation_id);

create index if not exists stock_transfers_organization_destination_status_idx
  on public.stock_transfers (organization_id, destination_store_id, status, completed_at desc);

create index if not exists stock_transfer_receipts_organization_operation_idx
  on public.stock_transfer_receipts (organization_id, operation_id);

comment on column public.stock_requests.operation_id is
  'Stable client-generated key. Retrying the same stock-request submission returns the original request.';
comment on column public.stock_transfers.transfer_number is
  'Organization-scoped sequential human transfer reference, displayed as TR-000001.';
comment on column public.stock_transfers.operation_id is
  'Stable client-generated key. Retrying a transfer dispatch returns the original transfer without subtracting source stock twice.';
comment on column public.stock_transfer_receipts.receipt_number is
  'Organization-scoped sequential transfer-receipt reference, displayed with its transfer number.';
comment on column public.stock_transfer_receipts.operation_id is
  'Stable client-generated key. Retrying a transfer receipt returns the original receipt without crediting destination stock twice.';
comment on column public.stock_transfer_receipts.operation_payload is
  'Normalized receipt command retained only to reject operation-key reuse with a different payload.';

-- A no-key stock-changing route cannot be safely retried. Replace only the
-- affected public/private signatures; the repository code is retained but the
-- immediate-shipment RPC is no longer executable by application clients.
drop function if exists public.create_stock_request(uuid, uuid, uuid, text, jsonb);
drop function if exists private.create_stock_request(uuid, uuid, uuid, text, jsonb);
drop function if exists public.dispatch_stock_request(uuid, uuid, text);
drop function if exists private.dispatch_stock_request(uuid, uuid, text);
drop function if exists public.receive_stock_request(uuid, uuid, jsonb, text);
drop function if exists private.receive_stock_request(uuid, uuid, jsonb, text);
drop function if exists public.receive_stock_transfer(uuid, uuid, jsonb, text);
drop function if exists private.receive_stock_transfer(uuid, uuid, jsonb, text);

create function private.create_stock_request(
  target_organization_id uuid,
  target_requesting_store_id uuid,
  target_source_warehouse_id uuid,
  target_note text,
  target_lines jsonb,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  request_id uuid;
  request_number bigint;
  warehouse_store_id uuid;
  existing_request public.stock_requests%rowtype;
  product_row record;
  line jsonb;
  normalized_note text;
  requested_lines jsonb;
  persisted_lines jsonb;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable stock-request operation ID is required.' using errcode = '23514';
  end if;

  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100
     or (target_note is not null and char_length(btrim(target_note)) > 500) then
    raise exception 'A stock request needs one to 100 items and valid notes.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
      or coalesce(requested.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (requested.value ? 'variant_id' and requested.value -> 'variant_id' <> 'null'::jsonb and coalesce(requested.value ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or coalesce(requested.value ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or (requested.value ->> 'quantity')::numeric <= 0
  ) then
    raise exception 'Request lines need active items and positive quantities.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select
        lower(btrim(value ->> 'product_id')) as product_id,
        coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
        count(*) as line_count
      from jsonb_array_elements(target_lines)
      group by 1, 2
    ) duplicate_line
    where duplicate_line.line_count > 1
  ) then
    raise exception 'Each request item can appear only once.' using errcode = '23514';
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
  into requested_lines
  from (
    select
      lower(btrim(value ->> 'product_id')) as product_id,
      coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
      ((value ->> 'quantity')::numeric(14,3))::text as quantity
    from jsonb_array_elements(target_lines)
  ) normalized;

  normalized_note := nullif(btrim(target_note), '');
  actor_id := private.inventory_actor(target_organization_id, target_requesting_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501';
  end if;

  select *
  into existing_request
  from public.stock_requests request_row
  where request_row.organization_id = target_organization_id
    and request_row.operation_id = target_operation_id
  for update;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', request_line.product_id::text,
          'variant_id', coalesce(request_line.variant_id::text, ''),
          'quantity', request_line.requested_quantity::text
        )
        order by request_line.product_id::text, coalesce(request_line.variant_id::text, '')
      ),
      '[]'::jsonb
    )
    into persisted_lines
    from public.stock_request_lines request_line
    where request_line.organization_id = target_organization_id
      and request_line.stock_request_id = existing_request.id;

    if existing_request.requesting_store_id = target_requesting_store_id
       and existing_request.source_warehouse_id = target_source_warehouse_id
       and existing_request.requested_by_employee_id = actor_id
       and existing_request.note is not distinct from normalized_note
       and persisted_lines = requested_lines then
      return existing_request.id;
    end if;

    raise exception 'This operation ID is already assigned to a different stock request.' using errcode = '23505';
  end if;

  select warehouse.store_id
  into warehouse_store_id
  from public.supply_chain_warehouses warehouse
  where warehouse.id = target_source_warehouse_id
    and warehouse.organization_id = target_organization_id
    and warehouse.is_active;

  if warehouse_store_id is null or warehouse_store_id = target_requesting_store_id then
    raise exception 'Choose an active warehouse at a different stock location.' using errcode = '23514';
  end if;

  request_number := nextval('private.tindio_stock_request_number_sequence'::regclass);
  insert into public.stock_requests (
    organization_id,
    request_number,
    requesting_store_id,
    source_warehouse_id,
    note,
    requested_by_employee_id,
    operation_id
  )
  values (
    target_organization_id,
    request_number,
    target_requesting_store_id,
    target_source_warehouse_id,
    normalized_note,
    actor_id,
    target_operation_id
  )
  returning id into request_id;

  for line in select value from jsonb_array_elements(target_lines) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '')
  loop
    select product.name as product_name, variant.name as variant_name, product.unit
    into product_row
    from public.products product
    left join public.product_variants variant
      on variant.id = nullif(line ->> 'variant_id', '')::uuid
      and variant.product_id = product.id
      and variant.organization_id = product.organization_id
    where product.id = (line ->> 'product_id')::uuid
      and product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
      and (nullif(line ->> 'variant_id', '') is null or variant.id is not null);

    if not found then
      raise exception 'Every request item must be an active tracked product.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id = target_requesting_store_id
        and level.product_id = (line ->> 'product_id')::uuid
        and level.variant_id is not distinct from nullif(line ->> 'variant_id', '')::uuid
    ) then
      raise exception 'Initialize the destination stock projection for every requested item.' using errcode = '23514';
    end if;

    insert into public.stock_request_lines (
      organization_id,
      stock_request_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      unit_snapshot,
      requested_quantity
    )
    values (
      target_organization_id,
      request_id,
      (line ->> 'product_id')::uuid,
      nullif(line ->> 'variant_id', '')::uuid,
      product_row.product_name,
      product_row.variant_name,
      product_row.unit,
      (line ->> 'quantity')::numeric(14,3)
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id,
    'STOCK_REQUEST_SUBMITTED',
    'inventory.manage',
    actor_id,
    null,
    target_requesting_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object('stock_request_id', request_id, 'request_number', request_number, 'source_warehouse_id', target_source_warehouse_id)
  );
  return request_id;
end;
$$;

create function public.create_stock_request(
  target_organization_id uuid,
  target_requesting_store_id uuid,
  target_source_warehouse_id uuid,
  target_note text,
  target_lines jsonb,
  target_operation_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_stock_request(
    target_organization_id,
    target_requesting_store_id,
    target_source_warehouse_id,
    target_note,
    target_lines,
    target_operation_id
  );
$$;

create function private.dispatch_stock_request(
  target_organization_id uuid,
  target_stock_request_id uuid,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.stock_requests%rowtype;
  existing_transfer public.stock_transfers%rowtype;
  actor_id uuid;
  warehouse_store_id uuid;
  transfer_id uuid;
  transfer_number bigint;
  request_line public.stock_request_lines%rowtype;
  source_level public.inventory_levels%rowtype;
  normalized_note text;
  effective_note text;
begin
  if (select auth.uid()) is null
     or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable transfer-dispatch operation ID is required.' using errcode = '23514';
  end if;

  if target_note is not null and char_length(btrim(target_note)) > 500 then
    raise exception 'Dispatch note is too long.' using errcode = '23514';
  end if;

  select *
  into request_row
  from public.stock_requests request_item
  where request_item.id = target_stock_request_id
    and request_item.organization_id = target_organization_id
  for update;

  if request_row.id is null then
    raise exception 'Choose a stock request in this organization.' using errcode = '23514';
  end if;

  select warehouse.store_id
  into warehouse_store_id
  from public.supply_chain_warehouses warehouse
  where warehouse.id = request_row.source_warehouse_id
    and warehouse.organization_id = target_organization_id
    and warehouse.is_active;

  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  effective_note := coalesce(normalized_note, request_row.note);

  select *
  into existing_transfer
  from public.stock_transfers transfer
  where transfer.organization_id = target_organization_id
    and transfer.operation_id = target_operation_id
  for update;

  if found then
    if existing_transfer.stock_request_id = request_row.id
       and existing_transfer.source_store_id = warehouse_store_id
       and existing_transfer.destination_store_id = request_row.requesting_store_id
       and existing_transfer.transferred_by_employee_id = actor_id
       and existing_transfer.note is not distinct from effective_note then
      return existing_transfer.id;
    end if;

    raise exception 'This operation ID is already assigned to a different transfer dispatch.' using errcode = '23505';
  end if;

  if request_row.status <> 'picking' then
    raise exception 'Only a picked request can be dispatched.' using errcode = '23514';
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
    warehouse_store_id,
    request_row.requesting_store_id,
    request_row.id,
    'in_transit',
    effective_note,
    actor_id
  )
  returning id into transfer_id;

  for request_line in
    select *
    from public.stock_request_lines item
    where item.stock_request_id = request_row.id
      and item.picked_quantity > 0
    order by item.product_id, item.variant_id
  loop
    select *
    into source_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = warehouse_store_id
      and level.product_id = request_line.product_id
      and level.variant_id is not distinct from request_line.variant_id
    for update;

    if source_level.id is null or source_level.quantity < request_line.picked_quantity then
      raise exception 'Source warehouse stock is insufficient for this request.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id = request_row.requesting_store_id
        and level.product_id = request_line.product_id
        and level.variant_id is not distinct from request_line.variant_id
    ) then
      raise exception 'The destination stock projection is not initialized for one requested item.' using errcode = '23514';
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
      request_line.id,
      request_line.product_id,
      request_line.variant_id,
      request_line.picked_quantity,
      source_level.average_cost_minor
    );

    perform private.apply_inventory_change_v2(
      target_organization_id,
      warehouse_store_id,
      request_line.product_id,
      request_line.variant_id,
      -request_line.picked_quantity,
      'TRANSFER_OUT',
      actor_id,
      format('Stock transfer TR-%s dispatched', lpad(transfer_number::text, 6, '0')),
      'stock_transfer',
      transfer_id,
      source_level.average_cost_minor
    );

    update public.stock_request_lines
    set dispatched_quantity = request_line.picked_quantity
    where id = request_line.id;
  end loop;

  update public.stock_requests
  set status = 'dispatched', dispatched_by_employee_id = actor_id, dispatched_at = now()
  where id = request_row.id;

  perform private.write_audit_log(
    target_organization_id,
    'STOCK_REQUEST_DISPATCHED',
    'inventory.manage',
    actor_id,
    null,
    warehouse_store_id,
    null,
    null,
    null,
    effective_note,
    jsonb_build_object(
      'stock_request_id', request_row.id,
      'request_number', request_row.request_number,
      'stock_transfer_id', transfer_id,
      'transfer_number', transfer_number,
      'destination_store_id', request_row.requesting_store_id
    )
  );
  return transfer_id;
end;
$$;

create function public.dispatch_stock_request(
  target_organization_id uuid,
  target_stock_request_id uuid,
  target_note text,
  target_operation_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.dispatch_stock_request(
    target_organization_id,
    target_stock_request_id,
    target_note,
    target_operation_id
  );
$$;

create function private.receive_stock_request(
  target_organization_id uuid,
  target_stock_request_id uuid,
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
  request_row public.stock_requests%rowtype;
  transfer_row public.stock_transfers%rowtype;
  existing_receipt public.stock_transfer_receipts%rowtype;
  actor_id uuid;
  receipt_id uuid;
  receipt_number bigint;
  line jsonb;
  transfer_line public.stock_transfer_lines%rowtype;
  request_line public.stock_request_lines%rowtype;
  received_now numeric(14,3);
  short_now numeric(14,3);
  remaining numeric(14,3);
  total_remaining numeric(14,3);
  has_shortage boolean;
  normalized_note text;
  requested_payload jsonb;
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
    raise exception 'A receipt needs one to 100 lines and valid notes.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) receipt(value)
    where jsonb_typeof(receipt.value) <> 'object'
      or coalesce(receipt.value ->> 'stock_transfer_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(receipt.value ->> 'received_quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or coalesce(receipt.value ->> 'short_quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or ((receipt.value ->> 'received_quantity')::numeric + (receipt.value ->> 'short_quantity')::numeric) <= 0
      or ((receipt.value ->> 'short_quantity')::numeric > 0 and char_length(btrim(coalesce(receipt.value ->> 'discrepancy_note', ''))) not between 2 and 500)
  )
  or (select count(*) from jsonb_array_elements(target_lines)) <> (
    select count(distinct value ->> 'stock_transfer_line_id') from jsonb_array_elements(target_lines)
  ) then
    raise exception 'Receipt lines, quantities, and discrepancy notes are invalid.' using errcode = '23514';
  end if;

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
      ((value ->> 'received_quantity')::numeric(14,3))::text as received_quantity,
      ((value ->> 'short_quantity')::numeric(14,3))::text as short_quantity,
      nullif(btrim(coalesce(value ->> 'discrepancy_note', '')), '') as discrepancy_note
    from jsonb_array_elements(target_lines)
  ) normalized;

  normalized_note := nullif(btrim(target_note), '');
  select *
  into request_row
  from public.stock_requests request_item
  where request_item.id = target_stock_request_id
    and request_item.organization_id = target_organization_id
  for update;

  if request_row.id is null then
    raise exception 'Choose a stock request in this organization.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, request_row.requesting_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501';
  end if;

  select *
  into transfer_row
  from public.stock_transfers transfer
  where transfer.organization_id = target_organization_id
    and transfer.stock_request_id = request_row.id
  for update;

  if transfer_row.id is null then
    raise exception 'The dispatched stock transfer is unavailable.' using errcode = '23514';
  end if;

  select *
  into existing_receipt
  from public.stock_transfer_receipts receipt
  where receipt.organization_id = target_organization_id
    and receipt.operation_id = target_operation_id
  for update;

  if found then
    if existing_receipt.stock_transfer_id = transfer_row.id
       and existing_receipt.destination_store_id = request_row.requesting_store_id
       and existing_receipt.received_by_employee_id = actor_id
       and existing_receipt.note is not distinct from normalized_note
       and existing_receipt.operation_payload = requested_payload then
      return request_row.id;
    end if;

    raise exception 'This operation ID is already assigned to a different transfer receipt.' using errcode = '23505';
  end if;

  if request_row.status not in ('dispatched', 'partially_received')
     or transfer_row.status not in ('in_transit', 'partially_received') then
    raise exception 'This request is not available for receiving.' using errcode = '23514';
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
    transfer_row.id,
    request_row.requesting_store_id,
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
      and item.stock_transfer_id = transfer_row.id
      and item.organization_id = target_organization_id
      and item.stock_request_line_id is not null
    for update;

    if transfer_line.id is null then
      raise exception 'A receipt line does not belong to this stock request.' using errcode = '23514';
    end if;

    select *
    into request_line
    from public.stock_request_lines item
    where item.id = transfer_line.stock_request_line_id
      and item.stock_request_id = request_row.id
      and item.organization_id = target_organization_id
    for update;

    received_now := (line ->> 'received_quantity')::numeric(14,3);
    short_now := (line ->> 'short_quantity')::numeric(14,3);
    remaining := transfer_line.quantity - transfer_line.received_quantity - transfer_line.short_quantity;

    if received_now + short_now > remaining then
      raise exception 'Received and short quantities cannot exceed the remaining dispatched quantity.' using errcode = '23514';
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
        request_row.requesting_store_id,
        transfer_line.product_id,
        transfer_line.variant_id,
        received_now,
        'TRANSFER_IN',
        actor_id,
        format('Transfer TR-%s receipt %s', lpad(transfer_row.transfer_number::text, 6, '0'), lpad(receipt_number::text, 6, '0')),
        'stock_transfer_receipt',
        receipt_id,
        transfer_line.unit_cost_minor
      );
    end if;

    update public.stock_transfer_lines
    set received_quantity = received_quantity + received_now,
        short_quantity = short_quantity + short_now
    where id = transfer_line.id;

    update public.stock_request_lines
    set received_quantity = received_quantity + received_now,
        short_quantity = short_quantity + short_now
    where id = request_line.id;

    if short_now > 0 then
      insert into public.stock_request_discrepancies (
        organization_id,
        stock_request_id,
        stock_request_line_id,
        stock_transfer_line_id,
        short_quantity,
        note,
        reported_by_employee_id
      )
      values (
        target_organization_id,
        request_row.id,
        request_line.id,
        transfer_line.id,
        short_now,
        btrim(line ->> 'discrepancy_note'),
        actor_id
      );
    end if;
  end loop;

  select coalesce(sum(quantity - received_quantity - short_quantity), 0)
  into total_remaining
  from public.stock_transfer_lines
  where stock_transfer_id = transfer_row.id;

  select exists (
    select 1
    from public.stock_transfer_lines
    where stock_transfer_id = transfer_row.id
      and short_quantity > 0
  )
  into has_shortage;

  update public.stock_transfers
  set status = case when total_remaining = 0 then 'completed' else 'partially_received' end,
      received_by_employee_id = actor_id,
      received_at = now(),
      completed_at = case when total_remaining = 0 then now() else completed_at end
  where id = transfer_row.id;

  update public.stock_requests
  set status = case when total_remaining > 0 then 'partially_received' when has_shortage then 'received_with_discrepancy' else 'received' end,
      received_by_employee_id = actor_id,
      received_at = case when total_remaining = 0 then now() else received_at end
  where id = request_row.id;

  perform private.write_audit_log(
    target_organization_id,
    case when total_remaining = 0 then 'STOCK_REQUEST_RECEIVED' else 'STOCK_REQUEST_PARTIALLY_RECEIVED' end,
    'inventory.manage',
    actor_id,
    null,
    request_row.requesting_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'stock_request_id', request_row.id,
      'request_number', request_row.request_number,
      'stock_transfer_id', transfer_row.id,
      'transfer_number', transfer_row.transfer_number,
      'receipt_id', receipt_id,
      'receipt_number', receipt_number,
      'remaining_quantity', total_remaining,
      'has_discrepancy', has_shortage
    )
  );
  return request_row.id;
end;
$$;

create function public.receive_stock_request(
  target_organization_id uuid,
  target_stock_request_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.receive_stock_request(
    target_organization_id,
    target_stock_request_id,
    target_lines,
    target_note,
    target_operation_id
  );
$$;

-- Generic transfer receipts remain only for historical transfers that pre-date
-- the request workflow. Request-linked transfers must record shortages through
-- public.receive_stock_request above.
create function private.receive_stock_transfer(
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
  line_quantity numeric(14,3);
  remaining numeric(14,3);
  total_remaining numeric(14,3);
  normalized_note text;
  requested_payload jsonb;
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
    raise exception 'A transfer receipt needs one to 100 items and valid notes.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) receipt(value)
    where jsonb_typeof(receipt.value) <> 'object'
      or coalesce(receipt.value ->> 'stock_transfer_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(receipt.value ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or (receipt.value ->> 'quantity')::numeric <= 0
  )
  or (select count(*) from jsonb_array_elements(target_lines)) <> (
    select count(distinct value ->> 'stock_transfer_line_id') from jsonb_array_elements(target_lines)
  ) then
    raise exception 'Receipt lines must include unique valid transfer lines and positive quantities.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stock_transfer_line_id', normalized.stock_transfer_line_id,
        'quantity', normalized.quantity
      )
      order by normalized.stock_transfer_line_id
    ),
    '[]'::jsonb
  )
  into requested_payload
  from (
    select
      lower(btrim(value ->> 'stock_transfer_line_id')) as stock_transfer_line_id,
      ((value ->> 'quantity')::numeric(14,3))::text as quantity
    from jsonb_array_elements(target_lines)
  ) normalized;

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
    for update;

    if transfer_line.id is null then
      raise exception 'A receipt line does not belong to this transfer.' using errcode = '23514';
    end if;

    line_quantity := (line ->> 'quantity')::numeric(14,3);
    remaining := transfer_line.quantity - transfer_line.received_quantity - transfer_line.short_quantity;
    if line_quantity > remaining then
      raise exception 'Received transfer quantity cannot exceed the remaining quantity.' using errcode = '23514';
    end if;

    insert into public.stock_transfer_receipt_lines (
      organization_id,
      stock_transfer_receipt_id,
      stock_transfer_line_id,
      quantity_received
    )
    values (target_organization_id, receipt_id, transfer_line.id, line_quantity);

    update public.stock_transfer_lines
    set received_quantity = received_quantity + line_quantity
    where id = transfer_line.id;

    perform private.apply_inventory_change_v2(
      target_organization_id,
      transfer.destination_store_id,
      transfer_line.product_id,
      transfer_line.variant_id,
      line_quantity,
      'TRANSFER_IN',
      actor_id,
      format('Transfer TR-%s receipt %s', lpad(transfer.transfer_number::text, 6, '0'), lpad(receipt_number::text, 6, '0')),
      'stock_transfer_receipt',
      receipt_id,
      transfer_line.unit_cost_minor
    );
  end loop;

  select coalesce(sum(quantity - received_quantity - short_quantity), 0)
  into total_remaining
  from public.stock_transfer_lines
  where stock_transfer_id = transfer.id;

  update public.stock_transfers
  set status = case when total_remaining = 0 then 'completed' else 'partially_received' end,
      received_by_employee_id = actor_id,
      received_at = now(),
      completed_at = case when total_remaining = 0 then now() else completed_at end
  where id = transfer.id;

  perform private.write_audit_log(
    target_organization_id,
    'STOCK_TRANSFER_RECEIVED',
    'inventory.manage',
    actor_id,
    null,
    transfer.destination_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'transfer_id', transfer.id,
      'transfer_number', transfer.transfer_number,
      'receipt_id', receipt_id,
      'receipt_number', receipt_number,
      'remaining_quantity', total_remaining
    )
  );
  return receipt_id;
end;
$$;

create function public.receive_stock_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.receive_stock_transfer(
    target_organization_id,
    target_stock_transfer_id,
    target_lines,
    target_note,
    target_operation_id
  );
$$;

revoke execute on function private.create_stock_request(uuid, uuid, uuid, text, jsonb, uuid), private.dispatch_stock_request(uuid, uuid, text, uuid), private.receive_stock_request(uuid, uuid, jsonb, text, uuid), private.receive_stock_transfer(uuid, uuid, jsonb, text, uuid), private.ship_stock_transfer(uuid, uuid, uuid, jsonb, text) from public, anon, service_role;
revoke execute on function public.create_stock_request(uuid, uuid, uuid, text, jsonb, uuid), public.dispatch_stock_request(uuid, uuid, text, uuid), public.receive_stock_request(uuid, uuid, jsonb, text, uuid), public.receive_stock_transfer(uuid, uuid, jsonb, text, uuid), public.ship_stock_transfer(uuid, uuid, uuid, jsonb, text) from public, anon, service_role;
revoke execute on function private.ship_stock_transfer(uuid, uuid, uuid, jsonb, text) from authenticated;
revoke execute on function public.ship_stock_transfer(uuid, uuid, uuid, jsonb, text) from authenticated;
grant execute on function private.create_stock_request(uuid, uuid, uuid, text, jsonb, uuid), private.dispatch_stock_request(uuid, uuid, text, uuid), private.receive_stock_request(uuid, uuid, jsonb, text, uuid), private.receive_stock_transfer(uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.create_stock_request(uuid, uuid, uuid, text, jsonb, uuid), public.dispatch_stock_request(uuid, uuid, text, uuid), public.receive_stock_request(uuid, uuid, jsonb, text, uuid), public.receive_stock_transfer(uuid, uuid, jsonb, text, uuid) to authenticated;

commit;
